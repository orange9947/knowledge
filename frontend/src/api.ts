import { getApiBaseUrl } from "./platform";

export type HealthResponse = {
  status: "ok";
  app_name: string;
  version: string;
  database: "ready";
};

export type LearningRun = {
  id: number;
  knowledge_base_id: number;
  keyword: string;
  mode: "light" | "standard" | "deep" | string;
  status: string;
  created_at: string;
  completed_at: string | null;
  language_policy: string;
  source_count: number;
  token_usage_estimate: number | null;
  error_summary: string | null;
  is_pinned: boolean;
  learning_prompt: string | null;
};

export type SourceRecord = {
  id: number;
  run_id: number;
  url: string;
  title: string | null;
  site: string | null;
  language: string | null;
  published_at: string | null;
  status: string;
  status_reason: string | null;
  snippet: string | null;
  extracted_text: string | null;
  content_hash: string | null;
  quality_score: number | null;
  is_pinned: boolean;
};

export type LearningCard = {
  id: number;
  run_id: number;
  type: string;
  title: string;
  summary: string;
  details: string | null;
  source_ids: number[];
  node_ids: number[];
  sort_order: number;
  approval_status: "candidate" | "approved" | string;
  candidate_payload: Record<string, unknown> | null;
};

export type KnowledgeNode = {
  id: number;
  knowledge_base_id: number;
  type: string;
  name: string;
  normalized_name: string;
  summary: string | null;
  aliases: string[];
  tags: string[];
};

export type KnowledgeNodeInput = {
  knowledge_base_id: number;
  type: string;
  name: string;
  summary?: string | null;
  aliases?: string[];
  tags?: string[];
};

export type KnowledgeNodeUpdate = Partial<Omit<KnowledgeNodeInput, "knowledge_base_id">>;

export type GraphData = {
  nodes: KnowledgeNode[];
  edges: Array<{
    id: number;
    knowledge_base_id: number;
    type: string;
    source_node_id: number;
    target_node_id: number;
  }>;
};

export type KnowledgeBase = {
  id: number;
  name: string;
  description: string | null;
  learning_prompt: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeExport = {
  version: number;
  knowledge_bases: KnowledgeBase[];
  runs: LearningRun[];
  sources: SourceRecord[];
  cards: LearningCard[];
  nodes: GraphData["nodes"];
  edges: GraphData["edges"];
};

export type RunDetail = {
  run: LearningRun;
  sources: SourceRecord[];
  cards: LearningCard[];
};

export type CardApprovalResult = {
  run: LearningRun;
  approved_count: number;
  skipped_count: number;
  approved_card_ids: number[];
  skipped_card_ids: number[];
  message: string;
};

export type ModelSettings = {
  id: number;
  name: string;
  base_url: string;
  model: string;
  api_key_reference: string | null;
  api_key_mask: string | null;
  default_temperature: number;
  max_tokens: number;
};

export type ModelSettingsInput = {
  name: string;
  base_url: string;
  model: string;
  api_key?: string;
  default_temperature: number;
  max_tokens: number;
};

export type ModelConnectionTestResult = {
  ok: boolean;
  message: string;
  model: string;
  latency_ms: number | null;
};

export type SourceSettings = {
  id: number;
  name: string;
  type: "builtin" | "rss" | "domain" | "entry_url" | "search_page" | string;
  enabled: boolean;
  url_or_domain: string | null;
  language_hint: string | null;
  crawl_depth: number;
  rate_limit: number | null;
  extractor_rule: Record<string, unknown> | null;
};

export type SourceSettingsInput = Omit<SourceSettings, "id">;

export type AssistantReference = {
  kind: "graph" | "web" | "model" | string;
  title: string;
  summary: string | null;
  node_id: number | null;
  source_id: number | null;
  url: string | null;
};

export type AssistantCandidateCard = {
  id: number | null;
  run_id: number | null;
  type: string;
  title: string;
  summary: string;
  details: string | null;
  source_ids: number[];
  approval_status: string;
};

export type AssistantResponse = {
  answer: string;
  used_web: boolean;
  run_id: number | null;
  graph_references: AssistantReference[];
  web_references: AssistantReference[];
  candidate_cards: AssistantCandidateCard[];
  warnings: string[];
};

export type AssistantQueryInput = {
  knowledge_base_id: number;
  question: string;
  selected_node_id?: number | null;
  allow_web: boolean;
  create_candidates: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = typeof payload.detail === "string" ? `：${payload.detail}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`请求失败：${response.status}${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function withKnowledgeBase(path: string, knowledgeBaseId?: number | null): string {
  if (!knowledgeBaseId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}knowledge_base_id=${knowledgeBaseId}`;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export async function fetchModelSettings(): Promise<ModelSettings | null> {
  return request<ModelSettings | null>("/settings/model");
}

export async function saveModelSettings(payload: ModelSettingsInput): Promise<ModelSettings> {
  return request<ModelSettings>("/settings/model", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function testModelConnection(payload: ModelSettingsInput): Promise<ModelConnectionTestResult> {
  return request<ModelConnectionTestResult>("/settings/model/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchSourceSettings(): Promise<SourceSettings[]> {
  return request<SourceSettings[]>("/settings/sources");
}

export async function saveSourceSettings(payload: SourceSettingsInput[]): Promise<SourceSettings[]> {
  return request<SourceSettings[]>("/settings/sources", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function fetchKnowledgeBases(): Promise<KnowledgeBase[]> {
  return request<KnowledgeBase[]>("/knowledge-bases");
}

export async function createKnowledgeBase(name: string, description?: string, learningPrompt?: string): Promise<KnowledgeBase> {
  return request<KnowledgeBase>("/knowledge-bases", {
    method: "POST",
    body: JSON.stringify({ name, description: description || null, learning_prompt: learningPrompt || null }),
  });
}

export async function updateKnowledgeBase(
  knowledgeBaseId: number,
  payload: { name?: string; description?: string | null; learning_prompt?: string | null },
): Promise<KnowledgeBase> {
  return request<KnowledgeBase>(`/knowledge-bases/${knowledgeBaseId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteKnowledgeBase(knowledgeBaseId: number): Promise<void> {
  return request<void>(`/knowledge-bases/${knowledgeBaseId}`, {
    method: "DELETE",
  });
}

export async function createRun(
  keyword: string,
  mode: string,
  knowledgeBaseId: number,
  learningPrompt?: string,
): Promise<LearningRun> {
  return request<LearningRun>("/runs", {
    method: "POST",
    body: JSON.stringify({
      keyword,
      mode,
      knowledge_base_id: knowledgeBaseId,
      learning_prompt: learningPrompt?.trim() || null,
    }),
  });
}

export async function fetchRuns(knowledgeBaseId?: number | null): Promise<LearningRun[]> {
  return request<LearningRun[]>(withKnowledgeBase("/runs", knowledgeBaseId));
}

export async function collectRun(runId: number): Promise<LearningRun> {
  return request<LearningRun>(`/runs/${runId}/collect`, {
    method: "POST",
  });
}

export async function aiCollectRun(runId: number): Promise<LearningRun> {
  return request<LearningRun>(`/runs/${runId}/ai-collect`, {
    method: "POST",
  });
}

export async function pauseRunCollection(runId: number): Promise<LearningRun> {
  return request<LearningRun>(`/runs/${runId}/pause`, {
    method: "POST",
  });
}

export async function summarizeRun(runId: number): Promise<LearningRun> {
  return request<LearningRun>(`/runs/${runId}/summarize`, {
    method: "POST",
  });
}

export async function fetchRunDetail(runId: number): Promise<RunDetail> {
  return request<RunDetail>(`/runs/${runId}`);
}

export async function updateRunRetention(runId: number, isPinned: boolean): Promise<LearningRun> {
  return request<LearningRun>(`/runs/${runId}/retention`, {
    method: "PATCH",
    body: JSON.stringify({ is_pinned: isPinned }),
  });
}

export async function deleteRun(runId: number): Promise<void> {
  return request<void>(`/runs/${runId}`, {
    method: "DELETE",
  });
}

export async function fetchRunSources(runId: number): Promise<SourceRecord[]> {
  return request<SourceRecord[]>(`/runs/${runId}/sources`);
}

export async function updateSourceRetention(sourceId: number, isPinned: boolean): Promise<SourceRecord> {
  return request<SourceRecord>(`/sources/${sourceId}/retention`, {
    method: "PATCH",
    body: JSON.stringify({ is_pinned: isPinned }),
  });
}

export async function clearSourceText(sourceId: number): Promise<SourceRecord> {
  return request<SourceRecord>(`/sources/${sourceId}/clear-text`, {
    method: "POST",
  });
}

export async function deleteSource(sourceId: number): Promise<void> {
  return request<void>(`/sources/${sourceId}`, {
    method: "DELETE",
  });
}

export async function fetchRunCards(runId: number): Promise<LearningCard[]> {
  return request<LearningCard[]>(`/runs/${runId}/cards`);
}

export async function approveRunCards(runId: number, cardIds: number[]): Promise<CardApprovalResult> {
  return request<CardApprovalResult>(`/runs/${runId}/cards/approve`, {
    method: "POST",
    body: JSON.stringify({ card_ids: cardIds }),
  });
}

export async function fetchGraph(knowledgeBaseId?: number | null): Promise<GraphData> {
  return request<GraphData>(withKnowledgeBase("/knowledge/graph", knowledgeBaseId));
}

export async function fetchKnowledgeNode(nodeId: number, knowledgeBaseId?: number | null): Promise<KnowledgeNode> {
  return request<KnowledgeNode>(withKnowledgeBase(`/knowledge/nodes/${nodeId}`, knowledgeBaseId));
}

export async function createKnowledgeNode(payload: KnowledgeNodeInput): Promise<KnowledgeNode> {
  return request<KnowledgeNode>("/knowledge/nodes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateKnowledgeNode(
  nodeId: number,
  payload: KnowledgeNodeUpdate,
  knowledgeBaseId?: number | null,
): Promise<KnowledgeNode> {
  return request<KnowledgeNode>(withKnowledgeBase(`/knowledge/nodes/${nodeId}`, knowledgeBaseId), {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteKnowledgeNode(nodeId: number, knowledgeBaseId?: number | null): Promise<void> {
  return request<void>(withKnowledgeBase(`/knowledge/nodes/${nodeId}`, knowledgeBaseId), {
    method: "DELETE",
  });
}

export async function searchKnowledge(
  query: string,
  knowledgeBaseId?: number | null,
  type?: string,
): Promise<KnowledgeNode[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (type) params.set("type", type);
  let path = `/knowledge/search${params.size ? `?${params.toString()}` : ""}`;
  path = withKnowledgeBase(path, knowledgeBaseId);
  return request<KnowledgeNode[]>(path);
}

export async function queryAssistant(payload: AssistantQueryInput): Promise<AssistantResponse> {
  return request<AssistantResponse>("/knowledge/assistant/query", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function exportKnowledge(knowledgeBaseId?: number | null): Promise<KnowledgeExport> {
  return request<KnowledgeExport>(withKnowledgeBase("/export", knowledgeBaseId));
}

export async function importKnowledge(payload: KnowledgeExport): Promise<KnowledgeExport> {
  return request<KnowledgeExport>("/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
