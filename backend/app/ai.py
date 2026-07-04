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


@dataclass(frozen=True)
class Material:
    title: str
    url: str
    site: str | None
    text: str


class AIOrchestrator:
    def __init__(self, timeout: float = 30.0, secret_store: SecretStore | None = None):
        self.timeout = timeout
        self.secret_store = secret_store or SecretStore()

    def generate(
        self,
        keyword: str,
        sources: list[models.Source],
        model_config: models.ModelConfig | None,
    ) -> AIOutput:
        materials = _source_materials(sources)
        if not materials:
            return fallback_output(keyword, [])

        api_key = self.secret_store.get(model_config.api_key_reference) if model_config else None
        if model_config and api_key:
            try:
                return self._generate_with_provider(keyword, materials, model_config, api_key)
            except (httpx.HTTPError, ValidationError, ValueError, KeyError, TypeError, json.JSONDecodeError):
                return fallback_output(keyword, materials)
        return fallback_output(keyword, materials)

    def _generate_with_provider(
        self,
        keyword: str,
        materials: list[Material],
        model_config: models.ModelConfig,
        api_key: str,
    ) -> AIOutput:
        prompt = _build_prompt(keyword, materials)
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
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        content = data["choices"][0]["message"]["content"]
        try:
            return _parse_ai_output(content)
        except (ValidationError, ValueError, TypeError, json.JSONDecodeError):
            return self._repair_provider_output(content, model_config, api_key)

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
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        repaired_content = data["choices"][0]["message"]["content"]
        return _parse_ai_output(repaired_content)

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
    ]
    nodes = [
        AINode(type="keyword", name=keyword, summary=f"{keyword} 学习主题", tags=["keyword"]),
        AINode(type="concept", name=f"{keyword} 核心知识点", tags=["key_point"]),
        AINode(type="skill", name=f"{keyword} 使用方法", tags=["usage"]),
        AINode(type="project", name=f"{keyword} 实践项目", tags=["practice"]),
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


def _build_prompt(keyword: str, materials: list[Material]) -> str:
    source_blocks = []
    for index, material in enumerate(materials[:10]):
        source_blocks.append(
            f"[{index}] title: {material.title}\nurl: {material.url}\ntext: {material.text[:1800]}"
        )
    return (
        f"关键词：{keyword}\n"
        "你是一个学习研究助手。请认真阅读下面的文章正文和摘要，比较不同来源，提炼真正有学习价值的信息。"
        "不要把搜索结果网页列表当作答案，不要简单复述标题，不要保留广告、导航、重复内容或低质量材料。"
        "请输出中文阅读分析，重点回答：核心知识点是什么、怎么使用、可以做什么项目、应该如何学习。"
        "每张卡片都必须引用 source_indexes，表示支撑这条结论的来源编号。"
        "严格返回 JSON，结构为："
        "{\"cards\":[{\"type\":\"key_point|usage_method|practice_project|learning_path|recommended_reading\","
        "\"title\":\"...\",\"summary\":\"...\",\"details\":\"...\",\"source_indexes\":[0]}],"
        "\"nodes\":[{\"type\":\"keyword|concept|skill|project|tool|source\",\"name\":\"...\","
        "\"summary\":\"...\",\"aliases\":[],\"tags\":[]}],"
        "\"edges\":[{\"source\":\"node name\",\"target\":\"node name\",\"type\":\"prerequisite|contains|related|applied_by|supported_by_source\","
        "\"confidence\":0.7,\"source_indexes\":[0]}]}。\n\n"
        + "\n\n".join(source_blocks)
    )


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
