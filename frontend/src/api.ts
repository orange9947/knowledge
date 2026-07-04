export type HealthResponse = {
  status: "ok";
  app_name: string;
  version: string;
  database: "ready";
};

export type LearningRun = {
  id: number;
  keyword: string;
  mode: "light" | "standard" | "deep" | string;
  status: string;
  created_at: string;
  completed_at: string | null;
  language_policy: string;
  source_count: number;
  token_usage_estimate: number | null;
  error_summary: string | null;
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
};

export type GraphData = {
  nodes: Array<{ id: number; type: string; name: string }>;
  edges: Array<{ id: number; type: string; source_node_id: number; target_node_id: number }>;
};

export type KnowledgeExport = {
  version: number;
  runs: LearningRun[];
  sources: SourceRecord[];
  cards: LearningCard[];
  nodes: GraphData["nodes"];
  edges: GraphData["edges"];
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
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

export async function fetchSourceSettings(): Promise<SourceSettings[]> {
  return request<SourceSettings[]>("/settings/sources");
}

export async function saveSourceSettings(payload: SourceSettingsInput[]): Promise<SourceSettings[]> {
  return request<SourceSettings[]>("/settings/sources", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function createRun(keyword: string, mode: string): Promise<LearningRun> {
  return request<LearningRun>("/runs", {
    method: "POST",
    body: JSON.stringify({ keyword, mode }),
  });
}

export async function fetchRuns(): Promise<LearningRun[]> {
  return request<LearningRun[]>("/runs");
}

export async function collectRun(runId: number): Promise<LearningRun> {
  return request<LearningRun>(`/runs/${runId}/collect`, {
    method: "POST",
  });
}

export async function fetchRunSources(runId: number): Promise<SourceRecord[]> {
  return request<SourceRecord[]>(`/runs/${runId}/sources`);
}

export async function fetchRunCards(runId: number): Promise<LearningCard[]> {
  return request<LearningCard[]>(`/runs/${runId}/cards`);
}

export async function fetchGraph(): Promise<GraphData> {
  return request<GraphData>("/knowledge/graph");
}

export async function exportKnowledge(): Promise<KnowledgeExport> {
  return request<KnowledgeExport>("/export");
}

export async function importKnowledge(payload: KnowledgeExport): Promise<KnowledgeExport> {
  return request<KnowledgeExport>("/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
