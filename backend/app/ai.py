import json
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


def fallback_output(keyword: str, materials: list[Material]) -> AIOutput:
    source_indexes = list(range(len(materials)))
    source_titles = [material.title for material in materials[:3]]
    source_summary = "、".join(source_titles) if source_titles else "当前来源"
    cards = [
        AICard(
            type="foundation",
            title=f"{keyword} 基础知识",
            summary=f"围绕 {keyword} 建立基础概念、常见术语和学习边界。",
            details=f"本地 fallback 根据已抓取材料生成，参考来源：{source_summary}。",
            source_indexes=source_indexes[:3],
        ),
        AICard(
            type="current_practice",
            title=f"{keyword} 最新实践",
            summary=f"关注 {keyword} 的项目、工具、工作流和落地技能。",
            details="后续接入模型 API 后，这里会由模型基于正文提炼更细的实践项目和技能。",
            source_indexes=source_indexes[:5],
        ),
        AICard(
            type="learning_path",
            title=f"{keyword} 学习路径",
            summary="先理解核心概念，再阅读官方或项目材料，最后挑一个小项目复现。",
            details="建议按：概念 -> 术语 -> 工具 -> 项目 -> 复盘笔记 的顺序学习。",
            source_indexes=source_indexes[:5],
        ),
    ]
    nodes = [
        AINode(type="keyword", name=keyword, summary=f"{keyword} 学习主题", tags=["keyword"]),
        AINode(type="concept", name=f"{keyword} 基础概念", tags=["foundation"]),
        AINode(type="skill", name=f"{keyword} 实践技能", tags=["practice"]),
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
        AIEdge(source=keyword, target=f"{keyword} 基础概念", type="contains", confidence=0.72),
        AIEdge(source=f"{keyword} 基础概念", target=f"{keyword} 实践技能", type="prerequisite", confidence=0.68),
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
        "请基于以下来源生成中文学习内容。严格返回 JSON，结构为："
        "{\"cards\":[{\"type\":\"foundation|term|learning_path|current_practice|project_tool|recommended_reading\","
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
