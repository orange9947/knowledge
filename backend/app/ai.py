import json
import time
from dataclasses import dataclass
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from app import models
from app.secrets import SecretStore


class AICard(BaseModel):
    type: str
    title: str
    summary: str
    details: str | None = None
    source_indexes: list[int] = Field(default_factory=list)


class AINode(BaseModel):
    type: str
    name: str
    summary: str | None = None
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class AIEdge(BaseModel):
    source: str
    target: str
    type: str
    confidence: float = Field(default=0.5, ge=0, le=1)
    source_indexes: list[int] = Field(default_factory=list)


class AIOutput(BaseModel):
    cards: list[AICard]
    nodes: list[AINode]
    edges: list[AIEdge]


class AIReference(BaseModel):
    kind: str
    title: str
    summary: str | None = None
    ref_id: str | None = None
    url: str | None = None


class AIAssistantOutput(BaseModel):
    answer: str
    graph_references: list[AIReference] = Field(default_factory=list)
    web_references: list[AIReference] = Field(default_factory=list)
    cards: list[AICard] = Field(default_factory=list)
    nodes: list[AINode] = Field(default_factory=list)
    edges: list[AIEdge] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class AIProviderError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class Material:
    title: str
    url: str
    site: str | None
    text: str


@dataclass(frozen=True)
class AITarget:
    url: str
    title: str | None = None
    reason: str | None = None


class AITargetPayload(BaseModel):
    url: str
    title: str | None = None
    reason: str | None = None


class AITargetOutput(BaseModel):
    targets: list[AITargetPayload] = Field(default_factory=list)


class AIOrchestrator:
    def __init__(self, timeout: float = 30.0, secret_store: SecretStore | None = None):
        self.timeout = timeout
        self.secret_store = secret_store or SecretStore()

    def generate(
        self,
        keyword: str,
        sources: list[models.Source],
        model_config: models.ModelConfig | None,
        knowledge_base_prompt: str | None = None,
        run_prompt: str | None = None,
    ) -> AIOutput:
        materials = _source_materials(sources)
        if not materials:
            return fallback_output(keyword, [])

        api_key = self.secret_store.get(model_config.api_key_reference) if model_config else None
        if model_config and api_key:
            try:
                return self._generate_with_provider(keyword, materials, model_config, api_key, knowledge_base_prompt, run_prompt)
            except (AIProviderError, httpx.HTTPError, ValidationError, ValueError, KeyError, TypeError, json.JSONDecodeError):
                return fallback_output(keyword, materials)
        return fallback_output(keyword, materials)

    def _generate_with_provider(
        self,
        keyword: str,
        materials: list[Material],
        model_config: models.ModelConfig,
        api_key: str,
        knowledge_base_prompt: str | None = None,
        run_prompt: str | None = None,
    ) -> AIOutput:
        prompt = _build_prompt(keyword, materials, knowledge_base_prompt, run_prompt)
        return self._generate_ai_output_with_prompt(prompt, model_config, api_key)

    def summarize_run(
        self,
        keyword: str,
        sources: list[models.Source],
        history_cards: list[models.Card],
        history_nodes: list[models.KnowledgeNode],
        model_config: models.ModelConfig | None,
        knowledge_base_prompt: str | None = None,
        run_prompt: str | None = None,
    ) -> AIOutput:
        materials = _source_materials(sources)
        if not materials:
            raise ValueError("没有可总结的素材正文")
        api_key = self._require_api_key(model_config)
        prompt = _build_summary_prompt(keyword, materials, history_cards, history_nodes, knowledge_base_prompt, run_prompt)
        return self._generate_ai_output_with_prompt(prompt, model_config, api_key)

    def answer_graph_question(
        self,
        question: str,
        graph_context: str,
        web_materials: list[Material],
        model_config: models.ModelConfig | None,
        knowledge_base_prompt: str | None = None,
        selected_node_name: str | None = None,
        create_candidates: bool = True,
    ) -> AIAssistantOutput:
        api_key = self._require_api_key(model_config)
        prompt = _build_assistant_prompt(
            question,
            graph_context,
            web_materials,
            knowledge_base_prompt,
            selected_node_name,
            create_candidates,
        )
        return self._generate_assistant_output_with_prompt(prompt, model_config, api_key)

    def suggest_collection_targets(
        self,
        keyword: str,
        history_cards: list[models.Card],
        history_nodes: list[models.KnowledgeNode],
        model_config: models.ModelConfig | None,
        knowledge_base_prompt: str | None = None,
        run_prompt: str | None = None,
    ) -> list[AITarget]:
        api_key = self._require_api_key(model_config)
        prompt = _build_target_prompt(keyword, history_cards, history_nodes, knowledge_base_prompt, run_prompt)
        payload = {
            "model": model_config.model,
            "temperature": model_config.default_temperature,
            "max_tokens": min(model_config.max_tokens, 2048),
            "messages": [
                {
                    "role": "system",
                    "content": "You return strict JSON for a Chinese learning research assistant. Return JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        url = f"{model_config.base_url.rstrip('/')}/chat/completions"
        data = self._post_chat_completion(url, headers, payload)
        content = data["choices"][0]["message"]["content"]
        try:
            parsed = AITargetOutput.model_validate(json.loads(_strip_code_fence(content)))
        except (ValidationError, ValueError, TypeError, json.JSONDecodeError) as exc:
            raise AIProviderError("模型返回格式异常，无法解析 AI 采集目标。") from exc
        return [
            AITarget(url=item.url, title=item.title, reason=item.reason)
            for item in parsed.targets
            if _is_collectable_url(item.url)
        ][:10]

    def _generate_ai_output_with_prompt(
        self,
        prompt: str,
        model_config: models.ModelConfig,
        api_key: str,
    ) -> AIOutput:
        payload = {
            "model": model_config.model,
            "temperature": model_config.default_temperature,
            "max_tokens": model_config.max_tokens,
            "messages": [
                {
                    "role": "system",
                    "content": "You produce strict JSON for a Chinese learning assistant. Return JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        url = f"{model_config.base_url.rstrip('/')}/chat/completions"
        data = self._post_chat_completion(url, headers, payload)
        content = data["choices"][0]["message"]["content"]
        try:
            return _parse_ai_output(content)
        except (ValidationError, ValueError, TypeError, json.JSONDecodeError):
            return self._repair_provider_output(content, model_config, api_key)

    def _generate_assistant_output_with_prompt(
        self,
        prompt: str,
        model_config: models.ModelConfig,
        api_key: str,
    ) -> AIAssistantOutput:
        payload = {
            "model": model_config.model,
            "temperature": model_config.default_temperature,
            "max_tokens": model_config.max_tokens,
            "messages": [
                {
                    "role": "system",
                    "content": "You produce strict JSON for a Chinese graph learning assistant. Return JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        url = f"{model_config.base_url.rstrip('/')}/chat/completions"
        data = self._post_chat_completion(url, headers, payload)
        content = data["choices"][0]["message"]["content"]
        try:
            return _parse_assistant_output(content)
        except (ValidationError, ValueError, TypeError, json.JSONDecodeError):
            return self._repair_assistant_output(content, model_config, api_key)

    def _require_api_key(self, model_config: models.ModelConfig | None) -> str:
        if model_config is None:
            raise ValueError("请先保存模型配置")
        api_key = self.secret_store.get(model_config.api_key_reference)
        if not api_key:
            raise ValueError("请先保存 API 密钥")
        return api_key

    def _repair_provider_output(
        self,
        content: str,
        model_config: models.ModelConfig,
        api_key: str,
    ) -> AIOutput:
        payload = {
            "model": model_config.model,
            "temperature": 0,
            "max_tokens": model_config.max_tokens,
            "messages": [
                {
                    "role": "system",
                    "content": "Repair malformed model output into strict JSON only. Do not add explanations.",
                },
                {
                    "role": "user",
                    "content": (
                        "Return valid JSON with keys cards, nodes, edges. Preserve the user's content where possible.\n\n"
                        f"{content}"
                    ),
                },
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        url = f"{model_config.base_url.rstrip('/')}/chat/completions"
        data = self._post_chat_completion(url, headers, payload)
        repaired_content = data["choices"][0]["message"]["content"]
        try:
            return _parse_ai_output(repaired_content)
        except (ValidationError, ValueError, TypeError, json.JSONDecodeError) as exc:
            raise AIProviderError("模型返回格式异常，自动修复后仍无法解析阅读分析结果。") from exc

    def _repair_assistant_output(
        self,
        content: str,
        model_config: models.ModelConfig,
        api_key: str,
    ) -> AIAssistantOutput:
        payload = {
            "model": model_config.model,
            "temperature": 0,
            "max_tokens": model_config.max_tokens,
            "messages": [
                {
                    "role": "system",
                    "content": "Repair malformed model output into strict graph assistant JSON only. Do not add explanations.",
                },
                {
                    "role": "user",
                    "content": (
                        "Return valid JSON with keys answer, graph_references, web_references, cards, nodes, edges, warnings. "
                        "Preserve the user's content where possible.\n\n"
                        f"{content}"
                    ),
                },
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        url = f"{model_config.base_url.rstrip('/')}/chat/completions"
        data = self._post_chat_completion(url, headers, payload)
        repaired_content = data["choices"][0]["message"]["content"]
        try:
            return _parse_assistant_output(repaired_content)
        except (ValidationError, ValueError, TypeError, json.JSONDecodeError) as exc:
            raise AIProviderError("模型返回格式异常，自动修复后仍无法解析图谱助手结果。") from exc

    def _post_chat_completion(self, url: str, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
        try:
            with httpx.Client(timeout=self._long_running_timeout()) as client:
                response = client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in {401, 403}:
                message = f"模型鉴权失败（HTTP {status}），请检查 API Key。"
            else:
                message = f"模型服务返回错误（HTTP {status}）。"
            raise AIProviderError(message) from exc
        except httpx.ConnectTimeout as exc:
            raise AIProviderError("模型服务连接超时，请检查 Base URL 或网络。") from exc
        except httpx.ReadTimeout as exc:
            raise AIProviderError("模型仍未返回结果。当前分析请求不会主动限制读取时长，请检查模型服务是否中断了连接。") from exc
        except httpx.HTTPError as exc:
            raise AIProviderError("模型请求失败，请检查模型服务地址、网络或代理配置。") from exc
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise AIProviderError("模型服务返回格式异常。") from exc

    def _long_running_timeout(self) -> httpx.Timeout:
        return httpx.Timeout(
            connect=min(self.timeout, 15.0),
            read=None,
            write=max(self.timeout, 30.0),
            pool=min(self.timeout, 15.0),
        )

    def test_connection(
        self,
        model_config: models.ModelConfig,
        api_key: str,
    ) -> tuple[bool, str, int | None]:
        payload = {
            "model": model_config.model,
            "temperature": 0,
            "max_tokens": min(model_config.max_tokens, 64),
            "messages": [
                {"role": "system", "content": "你是连通性测试助手，只返回简短中文。"},
                {"role": "user", "content": "请回复：连接成功"},
            ],
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        url = f"{model_config.base_url.rstrip('/')}/chat/completions"
        started = time.perf_counter()
        try:
            with httpx.Client(timeout=min(self.timeout, 15.0)) as client:
                response = client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
            content = data["choices"][0]["message"]["content"]
            latency_ms = int((time.perf_counter() - started) * 1000)
            if not str(content).strip():
                return False, "模型返回为空", latency_ms
            return True, "模型连接成功", latency_ms
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status in {401, 403}:
                return False, f"模型鉴权失败（HTTP {status}）", None
            return False, f"模型服务返回错误（HTTP {status}）", None
        except httpx.TimeoutException:
            return False, "模型连接超时", None
        except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            return False, "模型连接失败或返回格式异常", None


def fallback_output(keyword: str, materials: list[Material]) -> AIOutput:
    source_indexes = list(range(len(materials)))
    source_titles = [material.title for material in materials[:3]]
    source_summary = "、".join(source_titles) if source_titles else "当前来源"
    cards = [
        AICard(
            type="key_point",
            title=f"{keyword} 核心知识点",
            summary=f"围绕 {keyword} 提炼核心概念、关键结论和需要优先理解的问题。",
            details=f"本地 fallback 只能根据已抓取素材做粗略归纳，建议配置模型获得更完整的阅读分析。参考素材：{source_summary}。",
            source_indexes=source_indexes[:3],
        ),
        AICard(
            type="usage_method",
            title=f"{keyword} 使用方法",
            summary=f"梳理 {keyword} 的适用场景、常见用法、工具链和落地步骤。",
            details="配置模型后，这里会基于文章正文提炼具体方法、注意事项和可操作步骤。",
            source_indexes=source_indexes[:5],
        ),
        AICard(
            type="practice_project",
            title=f"{keyword} 实践项目",
            summary=f"从素材中归纳可练手的小项目、复现任务或验证方案。",
            details="优先选择能在本地或小规模环境中完成的项目，用来验证概念和工具链。",
            source_indexes=source_indexes[:5],
        ),
        AICard(
            type="learning_path",
            title=f"{keyword} 学习路径",
            summary="先理解核心概念，再掌握使用方法，最后通过项目复现并整理复盘。",
            details="建议按：核心概念 -> 关键术语 -> 使用方法 -> 实践项目 -> 复盘笔记 的顺序学习。",
            source_indexes=source_indexes[:5],
        ),
        AICard(
            type="recommended_reading",
            title=f"{keyword} 推荐阅读",
            summary="优先回看与知识点、方法步骤和实践项目直接相关的高价值素材。",
            details=f"从当前已抓取素材中优先参考：{source_summary}。",
            source_indexes=source_indexes[:5],
        ),
        AICard(
            type="keyword_hint",
            title=f"{keyword} 牵连关键词",
            summary=f"可继续关注 {keyword} 周边的核心术语、相关技术点和上下游概念。",
            details=f"本地 fallback 只能基于素材标题给出粗略提示，建议用模型提炼更准确的关键词知识点。参考素材：{source_summary}。",
            source_indexes=source_indexes[:5],
        ),
    ]
    nodes = [
        AINode(type="keyword", name=keyword, summary=f"{keyword} 学习主题", tags=["keyword"]),
        AINode(type="concept", name=f"{keyword} 核心知识点", tags=["key_point"]),
        AINode(type="skill", name=f"{keyword} 使用方法", tags=["usage"]),
        AINode(type="project", name=f"{keyword} 实践项目", tags=["practice"]),
        AINode(type="concept", name=f"{keyword} 牵连关键词", tags=["keyword_hint"]),
    ]
    for material in materials[:3]:
        source_node_name = _source_node_name(material)
        nodes.append(
            AINode(
                type="source",
                name=source_node_name,
                summary=material.site or material.url,
                tags=["source"],
            )
        )
    edges = [
        AIEdge(source=keyword, target=f"{keyword} 核心知识点", type="contains", confidence=0.72),
        AIEdge(source=f"{keyword} 核心知识点", target=f"{keyword} 使用方法", type="prerequisite", confidence=0.68),
        AIEdge(source=f"{keyword} 使用方法", target=f"{keyword} 实践项目", type="applied_by", confidence=0.66),
        AIEdge(source=keyword, target=f"{keyword} 牵连关键词", type="related", confidence=0.62),
    ]
    for material in materials[:3]:
        source_node_name = _source_node_name(material)
        edges.append(
            AIEdge(
                source=source_node_name,
                target=keyword,
                type="supported_by_source",
                confidence=0.6,
                source_indexes=[materials.index(material)],
            )
        )
    return AIOutput(cards=cards, nodes=nodes, edges=edges)


def _source_materials(sources: list[models.Source]) -> list[Material]:
    materials: list[Material] = []
    for source in sources:
        if source.status not in {"success", "partial"}:
            continue
        text = source.extracted_text or source.snippet
        if not text:
            continue
        materials.append(
            Material(
                title=source.title or source.site or source.url,
                url=source.url,
                site=source.site,
                text=text[:4000],
            )
        )
    return materials


def _source_node_name(material: Material) -> str:
    label = material.site or material.url
    return f"来源：{material.title}（{label}）"


def _build_prompt(
    keyword: str,
    materials: list[Material],
    knowledge_base_prompt: str | None = None,
    run_prompt: str | None = None,
) -> str:
    source_blocks = []
    for index, material in enumerate(materials[:10]):
        source_blocks.append(
            f"[{index}] title: {material.title}\nurl: {material.url}\ntext: {material.text[:1800]}"
        )
    return (
        f"关键词：{keyword}\n"
        f"{_preference_context(knowledge_base_prompt, run_prompt)}"
        "你是一个学习研究助手。请认真阅读下面的文章正文和摘要，比较不同来源，提炼真正有学习价值的信息。"
        "不要把搜索结果网页列表当作答案，不要简单复述标题，不要保留广告、导航、重复内容或低质量材料。"
        "请输出中文阅读分析，重点回答：核心知识点是什么、怎么使用、可以做什么项目、应该如何学习。"
        "同时提炼 5-10 个牵连关键词知识点，解释它们与本关键词的关系。"
        "每张卡片都必须引用 source_indexes，表示支撑这条结论的来源编号。"
        "严格返回 JSON，结构为："
        "{\"cards\":[{\"type\":\"key_point|usage_method|practice_project|learning_path|recommended_reading|keyword_hint\","
        "\"title\":\"...\",\"summary\":\"...\",\"details\":\"...\",\"source_indexes\":[0]}],"
        "\"nodes\":[{\"type\":\"keyword|concept|skill|project|tool|source\",\"name\":\"...\","
        "\"summary\":\"...\",\"aliases\":[],\"tags\":[]}],"
        "\"edges\":[{\"source\":\"node name\",\"target\":\"node name\",\"type\":\"prerequisite|contains|related|applied_by|supported_by_source\","
        "\"confidence\":0.7,\"source_indexes\":[0]}]}。\n\n"
        + "\n\n".join(source_blocks)
    )


def _build_summary_prompt(
    keyword: str,
    materials: list[Material],
    history_cards: list[models.Card],
    history_nodes: list[models.KnowledgeNode],
    knowledge_base_prompt: str | None = None,
    run_prompt: str | None = None,
) -> str:
    source_blocks = []
    for index, material in enumerate(materials[:12]):
        source_blocks.append(
            f"[{index}] title: {material.title}\nurl: {material.url}\ntext: {material.text[:1800]}"
        )
    history = _history_context(history_cards, history_nodes)
    return (
        f"关键词：{keyword}\n"
        f"{_preference_context(knowledge_base_prompt, run_prompt)}"
        "你是学习研究助手。请阅读本次抓取的网页正文，并与已有知识库内容对比。"
        "目标是筛掉重复、空泛、广告化、低价值内容，只输出本次材料相对已有知识真正新增或更值得学习的内容。"
        "必须输出中文 JSON，不要解释 JSON 之外的内容。"
        "输出至少包含：1 张 type=summary 的本次素材总结卡片，1-3 张 type=keyword_hint 的牵连关键词知识点卡片；"
        "如果有新的核心知识、使用方法或项目，也可以输出 key_point、usage_method、practice_project、learning_path、recommended_reading。"
        "每张卡片必须引用 source_indexes。nodes 中要包含新增或强化的关键词/概念/技能/项目节点，edges 中表达依赖、关联或来源支撑。"
        "严格 JSON 结构为："
        "{\"cards\":[{\"type\":\"summary|keyword_hint|key_point|usage_method|practice_project|learning_path|recommended_reading\","
        "\"title\":\"...\",\"summary\":\"...\",\"details\":\"...\",\"source_indexes\":[0]}],"
        "\"nodes\":[{\"type\":\"keyword|concept|skill|project|tool|source\",\"name\":\"...\","
        "\"summary\":\"...\",\"aliases\":[],\"tags\":[]}],"
        "\"edges\":[{\"source\":\"node name\",\"target\":\"node name\",\"type\":\"prerequisite|contains|related|applied_by|supported_by_source\","
        "\"confidence\":0.7,\"source_indexes\":[0]}]}。\n\n"
        f"已有知识库摘要：\n{history}\n\n"
        "本次素材：\n"
        + "\n\n".join(source_blocks)
    )


def _build_target_prompt(
    keyword: str,
    history_cards: list[models.Card],
    history_nodes: list[models.KnowledgeNode],
    knowledge_base_prompt: str | None = None,
    run_prompt: str | None = None,
) -> str:
    history = _history_context(history_cards, history_nodes)
    return (
        f"关键词：{keyword}\n"
        f"{_preference_context(knowledge_base_prompt, run_prompt)}"
        "请作为学习研究助手，为该关键词推荐 5-8 个值得直接抓取阅读的网页 URL。"
        "要求：只返回具体文章、官方文档、项目仓库、技术问答或论文页面；不要返回搜索结果页、首页、登录页、广告页、聚合页。"
        "请结合已有知识库内容，避开明显重复、过浅或低价值的材料，优先选择能带来新增知识点、使用方法、实践项目或学习路径的页面。"
        "严格返回 JSON，结构为："
        "{\"targets\":[{\"url\":\"https://...\",\"title\":\"...\",\"reason\":\"为什么值得采集\"}]}。\n\n"
        f"已有知识库摘要：\n{history}"
    )


def _build_assistant_prompt(
    question: str,
    graph_context: str,
    web_materials: list[Material],
    knowledge_base_prompt: str | None = None,
    selected_node_name: str | None = None,
    create_candidates: bool = True,
) -> str:
    web_blocks = []
    for index, material in enumerate(web_materials[:6]):
        web_blocks.append(
            f"[web:{index}] title: {material.title}\nurl: {material.url}\nsite: {material.site or ''}\ntext: {material.text[:1800]}"
        )
    candidate_instruction = (
        "如果回答中有值得沉淀的新知识，请输出 1-5 张候选卡片，并在 nodes/edges 中给出可加入图谱的节点和关系；"
        if create_candidates
        else "本次不要输出候选卡片，cards、nodes、edges 返回空数组；"
    )
    selected_context = f"当前选中节点：{selected_node_name}\n" if selected_node_name else ""
    web_context = "\n\n".join(web_blocks) if web_blocks else "本次没有联网补充材料。"
    return (
        f"用户问题：{question.strip()}\n"
        f"{selected_context}"
        f"{_preference_context(knowledge_base_prompt, None)}"
        "你是知识图谱学习助手。请优先基于当前知识库回答；如果提供了联网材料，可以作为补充。"
        "回答必须用中文，必须明确区分：图谱内容、联网补充、模型推断。"
        "不要把联网补充当成已沉淀图谱事实；不要直接声明已加入图谱。"
        f"{candidate_instruction}"
        "严格返回 JSON，结构为："
        "{\"answer\":\"包含 图谱内容/联网补充/模型推断 的中文回答\","
        "\"graph_references\":[{\"kind\":\"graph\",\"title\":\"...\",\"summary\":\"...\",\"ref_id\":\"node:1\"}],"
        "\"web_references\":[{\"kind\":\"web\",\"title\":\"...\",\"summary\":\"...\",\"ref_id\":\"source:1\",\"url\":\"https://...\"}],"
        "\"cards\":[{\"type\":\"summary|keyword_hint|key_point|usage_method|practice_project|learning_path|recommended_reading\","
        "\"title\":\"...\",\"summary\":\"...\",\"details\":\"...\",\"source_indexes\":[0]}],"
        "\"nodes\":[{\"type\":\"keyword|concept|skill|project|tool|method|source\",\"name\":\"...\","
        "\"summary\":\"...\",\"aliases\":[],\"tags\":[]}],"
        "\"edges\":[{\"source\":\"node name\",\"target\":\"node name\",\"type\":\"related|contains|prerequisite|applied_by|supported_by_source\","
        "\"confidence\":0.7,\"source_indexes\":[0]}],"
        "\"warnings\":[\"...\"]}。\n\n"
        f"当前知识库上下文：\n{graph_context}\n\n"
        f"联网补充材料：\n{web_context}"
    )


def _history_context(history_cards: list[models.Card], history_nodes: list[models.KnowledgeNode]) -> str:
    card_lines = [
        f"- 卡片：{card.title} / {card.summary[:180]}"
        for card in history_cards[:20]
        if card.title or card.summary
    ]
    node_lines = [
        f"- 节点：{node.name} / {(node.summary or '')[:160]}"
        for node in history_nodes[:30]
        if node.name
    ]
    lines = [*card_lines, *node_lines]
    return "\n".join(lines) if lines else "暂无历史知识。"


def _preference_context(knowledge_base_prompt: str | None, run_prompt: str | None) -> str:
    lines = []
    if knowledge_base_prompt:
        lines.append(f"知识库默认学习偏好：{knowledge_base_prompt.strip()}")
    if run_prompt:
        lines.append(f"本次学习偏好：{run_prompt.strip()}")
    if not lines:
        return ""
    return (
        "请将以下学习偏好作为筛选依据，优先保留匹配学习阶段、兴趣方向和实践目标的内容，"
        "弱相关或不符合偏好的内容可以降权或忽略。\n"
        + "\n".join(lines)
        + "\n"
    )


def _is_collectable_url(url: str) -> bool:
    lowered = url.strip().lower()
    if not lowered.startswith(("http://", "https://")):
        return False
    blocked_fragments = [
        "google.com/search",
        "bing.com/search",
        "github.com/search",
        "juejin.cn/search",
        "dev.to/search",
        "stackoverflow.com/search",
        "hn.algolia.com",
        "/login",
        "/signin",
    ]
    return not any(fragment in lowered for fragment in blocked_fragments)


def _strip_code_fence(content: str) -> str:
    stripped = content.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return stripped


def _parse_ai_output(content: str) -> AIOutput:
    return AIOutput.model_validate(json.loads(_strip_code_fence(content)))


def _parse_assistant_output(content: str) -> AIAssistantOutput:
    return AIAssistantOutput.model_validate(json.loads(_strip_code_fence(content)))
