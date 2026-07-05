import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@antv/g6", () => {
  class MockGraph {
    static instances: MockGraph[] = [];
    fitView = vi.fn(() => Promise.resolve());
    optionHistory: unknown[] = [];
    options: unknown;

    constructor(options: unknown) {
      this.options = options;
      this.optionHistory.push(options);
      MockGraph.instances.push(this);
    }
    destroy() {}
    on() {}
    render() {
      return Promise.resolve();
    }
    setOptions(options: unknown) {
      this.options = options;
      this.optionHistory.push(options);
    }
  }

  return { Graph: MockGraph };
});

import App from "./App";
import { Graph as MockedGraph } from "@antv/g6";

type MockGraphNode = {
  aliases: string[];
  id: number;
  knowledge_base_id: number;
  name: string;
  normalized_name: string;
  summary: string | null;
  tags: string[];
  type: string;
};

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (MockedGraph as unknown as { instances: unknown[] }).instances = [];
  });

  afterEach(() => {
    cleanup();
    delete window.__AILKG_RUNTIME__;
  });

  it("renders the learning workspace shell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: "ok",
              app_name: "AI 学习知识图谱",
              version: "0.1.0",
              database: "ready",
            }),
          });
        }
        if (url.endsWith("/settings/model")) {
          return Promise.resolve({
            ok: true,
            json: async () => null,
          });
        }
        if (url.endsWith("/knowledge/graph")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ nodes: [], edges: [] }),
          });
        }
        if (url.endsWith("/knowledge-bases")) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 1,
                name: "默认知识库",
                description: "默认知识库",
                learning_prompt: "我是初学者",
                created_at: "2026-07-04T00:00:00Z",
                updated_at: "2026-07-04T00:00:00Z",
              },
            ],
          });
        }
        if (
          url.endsWith("/settings/sources") ||
          url.includes("/runs") ||
          url.endsWith("/sources") ||
          url.endsWith("/cards")
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({}),
        });
      }),
    );

    render(<App />);

    expect(screen.getByRole("heading", { name: "AI 学习知识图谱" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "知识提炼" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "文章素材" })).toBeInTheDocument();
    expect(screen.getByLabelText("阅读分析模型配置")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "知识库" })).toBeInTheDocument();
    expect(await screen.findByText("API 0.1.0")).toBeInTheDocument();
  });

  it("keeps primary navigation accessible for packaged mobile layouts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: "ok",
              app_name: "AI 学习知识图谱",
              version: "0.1.0",
              database: "ready",
            }),
          });
        }
        if (url.endsWith("/knowledge-bases")) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              {
                id: 1,
                name: "默认知识库",
                description: "默认知识库",
                learning_prompt: null,
                created_at: "2026-07-04T00:00:00Z",
                updated_at: "2026-07-04T00:00:00Z",
              },
            ],
          });
        }
        if (url.endsWith("/settings/model")) return Promise.resolve({ ok: true, json: async () => null });
        if (url.endsWith("/knowledge/graph")) {
          return Promise.resolve({ ok: true, json: async () => ({ nodes: [], edges: [] }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: "学习" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "图谱" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "历史" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
  });

  it("adds the injected runtime class to the shell", async () => {
    window.__AILKG_RUNTIME__ = {
      apiBaseUrl: "http://127.0.0.1:43125",
      platform: "desktop",
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      expect(url.startsWith("http://127.0.0.1:43125")).toBe(true);
      return Promise.resolve({
        ok: true,
        json: async () => {
          if (url.endsWith("/health")) {
            return {
              status: "ok",
              app_name: "AI 学习知识图谱",
              version: "0.1.0",
              database: "ready",
            };
          }
          if (url.endsWith("/knowledge-bases")) {
            return [
              {
                id: 1,
                name: "默认知识库",
                description: "默认知识库",
                learning_prompt: null,
                created_at: "2026-07-04T00:00:00Z",
                updated_at: "2026-07-04T00:00:00Z",
              },
            ];
          }
          if (url.endsWith("/settings/model")) return null;
          if (url.endsWith("/knowledge/graph")) return { nodes: [], edges: [] };
          return [];
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("API 0.1.0")).toBeInTheDocument();
    expect(document.querySelector(".app-shell")).toHaveClass("runtime-desktop");
  });

  it("retries Android local API while the embedded backend is starting", async () => {
    window.__AILKG_RUNTIME__ = {
      platform: "android",
    };
    let healthAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      expect(url.startsWith("http://127.0.0.1:43126")).toBe(true);
      if (url.endsWith("/health")) {
        healthAttempts += 1;
        if (healthAttempts === 1) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "ok",
            app_name: "AI 学习知识图谱",
            version: "0.1.0",
            database: "ready",
          }),
        });
      }
      if (url.endsWith("/knowledge-bases")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 1,
              name: "默认知识库",
              description: "默认知识库",
              learning_prompt: null,
              created_at: "2026-07-04T00:00:00Z",
              updated_at: "2026-07-04T00:00:00Z",
            },
          ],
        });
      }
      if (url.endsWith("/settings/model")) return Promise.resolve({ ok: true, json: async () => null });
      if (url.endsWith("/knowledge/graph")) return Promise.resolve({ ok: true, json: async () => ({ nodes: [], edges: [] }) });
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("API 0.1.0")).toBeInTheDocument();
    expect(healthAttempts).toBe(2);
    expect(document.querySelector(".app-shell")).toHaveClass("runtime-android");
  });

  it("switches sidebar buttons to matching workspace panels", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let graphNodes: MockGraphNode[] = [
      {
        id: 1,
        knowledge_base_id: 1,
        type: "keyword",
        name: "RAG",
        normalized_name: "rag",
        summary: "Retrieval augmented generation",
        aliases: [],
        tags: ["keyword"],
      },
      {
        id: 2,
        knowledge_base_id: 1,
        type: "concept",
        name: "检索增强",
        normalized_name: "检索增强",
        summary: "结合检索和生成",
        aliases: ["Retrieval Augmentation"],
        tags: ["concept"],
      },
    ];
    let graphEdges = [
      {
        id: 1,
        knowledge_base_id: 1,
        source_node_id: 1,
        target_node_id: 2,
        type: "related_to",
        confidence: 0.8,
        evidence_source_ids: [],
      },
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: "ok",
            app_name: "AI 学习知识图谱",
            version: "0.1.0",
            database: "ready",
          }),
        });
      }
      if (url.endsWith("/settings/model")) {
        return Promise.resolve({ ok: true, json: async () => null });
      }
      if (url.endsWith("/settings/model/test") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            message: "模型连接成功",
            model: "gpt-4.1-mini",
            latency_ms: 42,
          }),
        });
      }
      if (url.endsWith("/runs/8/ai-collect") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 8,
            knowledge_base_id: 1,
            keyword: "AI 智能体",
            mode: "light",
            status: "completed",
            created_at: "2026-07-04T00:00:00Z",
            completed_at: "2026-07-04T00:00:00Z",
            language_policy: "zh-en-to-zh",
            source_count: 1,
            token_usage_estimate: null,
            error_summary: null,
            is_pinned: false,
            learning_prompt: "本次关注工具链",
          }),
        });
      }
      if (url.endsWith("/runs/8/sources")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 8,
              run_id: 8,
              url: "https://example.com/agent-guide",
              title: "Agent guide",
              site: "example.com",
              language: "en",
              published_at: null,
              status: "success",
              status_reason: null,
              snippet: null,
              extracted_text: "Agent guide body",
              content_hash: "hash-8",
              quality_score: 1,
              is_pinned: false,
            },
          ],
        });
      }
      if (url.endsWith("/runs/8/cards")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 81,
              run_id: 8,
              type: "summary",
              title: "AI 智能体 AI 采集总结",
              summary: "新增工具调用实践",
              details: "已过滤重复内容",
              source_ids: [8],
              node_ids: [],
              sort_order: 0,
              approval_status: "candidate",
              candidate_payload: null,
            },
            {
              id: 82,
              run_id: 8,
              type: "keyword_hint",
              title: "工具调用",
              summary: "与 AI 智能体执行外部动作相关",
              details: null,
              source_ids: [8],
              node_ids: [],
              sort_order: 1,
              approval_status: "candidate",
              candidate_payload: null,
            },
          ],
        });
      }
      if (url.endsWith("/runs/8/cards/approve") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 8,
            knowledge_base_id: 1,
            keyword: "AI 智能体",
            mode: "light",
            status: "completed",
            created_at: "2026-07-04T00:00:00Z",
            completed_at: "2026-07-04T00:00:00Z",
            language_policy: "zh-en-to-zh",
            source_count: 1,
            token_usage_estimate: null,
            error_summary: null,
            is_pinned: false,
            learning_prompt: "本次关注工具链",
          }),
        });
      }
      if (url.endsWith("/knowledge/assistant/query") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            answer: "图谱内容：RAG 已有基础关系。\n联网补充：补充了重排序方向。\n模型推断：建议下一步学习检索后处理。",
            used_web: true,
            run_id: 9,
            graph_references: [
              {
                kind: "graph",
                title: "RAG",
                summary: "Retrieval augmented generation",
                node_id: 1,
                source_id: null,
                url: null,
              },
            ],
            web_references: [
              {
                kind: "web",
                title: "RAG rerank guide",
                summary: "联网补充材料",
                node_id: null,
                source_id: 9,
                url: "https://example.com/rerank",
              },
            ],
            candidate_cards: [
              {
                id: 91,
                run_id: 9,
                type: "keyword_hint",
                title: "重排序",
                summary: "检索后对候选内容重新排序",
                details: null,
                source_ids: [9],
                approval_status: "candidate",
              },
            ],
            warnings: [],
          }),
        });
      }
      if (url.endsWith("/runs/9/cards/approve") && init?.method === "POST") {
        graphNodes = [
          ...graphNodes,
          {
            id: 4,
            knowledge_base_id: 1,
            type: "concept",
            name: "重排序",
            normalized_name: "重排序",
            summary: "检索后对候选内容重新排序",
            aliases: [],
            tags: ["keyword_hint"],
          },
        ];
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 9,
            knowledge_base_id: 1,
            keyword: "AI助手：我下一步应该学什么？",
            mode: "light",
            status: "completed",
            created_at: "2026-07-04T00:00:00Z",
            completed_at: "2026-07-04T00:00:00Z",
            language_policy: "zh-en-to-zh",
            source_count: 1,
            token_usage_estimate: null,
            error_summary: null,
            is_pinned: false,
            learning_prompt: null,
          }),
        });
      }
      if (url.endsWith("/runs/9")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            run: {
              id: 9,
              knowledge_base_id: 1,
              keyword: "AI助手：我下一步应该学什么？",
              mode: "light",
              status: "completed",
              created_at: "2026-07-04T00:00:00Z",
              completed_at: "2026-07-04T00:00:00Z",
              language_policy: "zh-en-to-zh",
              source_count: 1,
              token_usage_estimate: null,
              error_summary: null,
              is_pinned: false,
              learning_prompt: null,
            },
            sources: [],
            cards: [
              {
                id: 91,
                run_id: 9,
                type: "keyword_hint",
                title: "重排序",
                summary: "检索后对候选内容重新排序",
                details: null,
                source_ids: [9],
                node_ids: [4],
                sort_order: 0,
                approval_status: "approved",
                candidate_payload: null,
              },
            ],
          }),
        });
      }
      if (url.endsWith("/runs/7/summarize") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 7,
            knowledge_base_id: 1,
            keyword: "RAG",
            mode: "light",
            status: "partial",
            created_at: "2026-07-04T00:00:00Z",
            completed_at: null,
            language_policy: "zh-en-to-zh",
            source_count: 1,
            token_usage_estimate: null,
            error_summary: null,
            is_pinned: false,
            learning_prompt: null,
          }),
        });
      }
      if (url.endsWith("/runs/7/cards")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 71,
              run_id: 7,
              type: "summary",
              title: "RAG 本次总结",
              summary: "新增重排序知识",
              details: "已过滤重复内容",
              source_ids: [1],
              node_ids: [],
              sort_order: 0,
              approval_status: "candidate",
              candidate_payload: null,
            },
            {
              id: 72,
              run_id: 7,
              type: "keyword_hint",
              title: "重排序",
              summary: "RAG 的牵连知识点",
              details: null,
              source_ids: [1],
              node_ids: [],
              sort_order: 1,
              approval_status: "candidate",
              candidate_payload: null,
            },
          ],
        });
      }
      if (url.endsWith("/knowledge-bases")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 1,
              name: "默认知识库",
              description: null,
              learning_prompt: "我是初学者",
              created_at: "2026-07-04T00:00:00Z",
              updated_at: "2026-07-04T00:00:00Z",
            },
            {
              id: 2,
              name: "机器人",
              description: "机器人学习",
              learning_prompt: null,
              created_at: "2026-07-04T00:00:00Z",
              updated_at: "2026-07-04T00:00:00Z",
            },
          ],
        });
      }
      if (url.endsWith("/knowledge-bases/2") && init?.method === "DELETE") {
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      if (url.endsWith("/knowledge-bases/1") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)) as { learning_prompt?: string | null };
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 1,
            name: "默认知识库",
            description: null,
            learning_prompt: payload.learning_prompt,
            created_at: "2026-07-04T00:00:00Z",
            updated_at: "2026-07-04T00:00:00Z",
          }),
        });
      }
      if (url.includes("/knowledge/graph")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            nodes: graphNodes,
            edges: graphEdges,
          }),
        });
      }
      if (url.endsWith("/knowledge/nodes") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as {
          aliases?: string[];
          name: string;
          summary?: string | null;
          tags?: string[];
          type: string;
        };
        const created = {
          id: 3,
          knowledge_base_id: 1,
          type: payload.type,
          name: payload.name,
          normalized_name: payload.name.toLowerCase(),
          summary: payload.summary ?? null,
          aliases: payload.aliases ?? [],
          tags: payload.tags ?? [],
        };
        graphNodes = [...graphNodes, created];
        return Promise.resolve({ ok: true, json: async () => created });
      }
      if (url.includes("/knowledge/nodes/3") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)) as {
          aliases?: string[];
          name?: string;
          summary?: string | null;
          tags?: string[];
          type?: string;
        };
        graphNodes = graphNodes.map((node) =>
          node.id === 3
            ? {
                ...node,
                ...payload,
                name: payload.name ?? node.name,
                normalized_name: (payload.name ?? node.name).toLowerCase(),
                summary: payload.summary ?? node.summary,
                aliases: payload.aliases ?? node.aliases,
                tags: payload.tags ?? node.tags,
              }
            : node,
        );
        return Promise.resolve({
          ok: true,
          json: async () => graphNodes.find((node) => node.id === 3),
        });
      }
      if (url.includes("/knowledge/nodes/3") && init?.method === "DELETE") {
        graphNodes = graphNodes.filter((node) => node.id !== 3);
        graphEdges = graphEdges.filter((edge) => edge.source_node_id !== 3 && edge.target_node_id !== 3);
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      if (url.includes("/knowledge/nodes/1")) {
        return Promise.resolve({
          ok: true,
          json: async () => graphNodes.find((node) => node.id === 1),
        });
      }
      if (url.includes("/knowledge/nodes/2")) {
        return Promise.resolve({
          ok: true,
          json: async () => graphNodes.find((node) => node.id === 2),
        });
      }
      if (url.endsWith("/runs/7")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            run: {
              id: 7,
              knowledge_base_id: 1,
              keyword: "RAG",
              mode: "light",
              status: "partial",
              created_at: "2026-07-04T00:00:00Z",
              completed_at: null,
              language_policy: "zh-en-to-zh",
              source_count: 1,
              token_usage_estimate: null,
              error_summary: null,
              is_pinned: false,
              learning_prompt: null,
            },
            sources: [
              {
                id: 1,
                run_id: 7,
                url: "https://github.com/search?q=RAG",
                title: "RAG repositories",
                site: "github.com",
                language: "en",
                published_at: null,
                status: "success",
                status_reason: null,
                snippet: null,
                extracted_text: "RAG material",
                content_hash: "hash",
                quality_score: 1,
                is_pinned: false,
              },
            ],
            cards: [],
          }),
        });
      }
      if (url.endsWith("/runs") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 8,
            knowledge_base_id: 1,
            keyword: "AI 智能体",
            mode: "light",
            status: "pending",
            created_at: "2026-07-04T00:00:00Z",
            completed_at: null,
            language_policy: "zh-en-to-zh",
            source_count: 0,
            token_usage_estimate: null,
            error_summary: null,
            is_pinned: false,
            learning_prompt: "关注项目实战",
          }),
        });
      }
      if (url.endsWith("/settings/sources") && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
        return Promise.resolve({
          ok: true,
          json: async () => payload.map((source, index) => ({ ...source, id: index + 1 })),
        });
      }
      if (url.endsWith("/settings/sources")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 1,
              name: "GitHub 仓库",
              type: "builtin",
              enabled: true,
              url_or_domain: "github.com",
              language_hint: "en",
              crawl_depth: 1,
              rate_limit: null,
              extractor_rule: null,
            },
          ],
        });
      }
      if (url.endsWith("/runs/7/retention") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 7,
            knowledge_base_id: 1,
            keyword: "RAG",
            mode: "light",
            status: "partial",
            created_at: "2026-07-04T00:00:00Z",
            completed_at: null,
            language_policy: "zh-en-to-zh",
            source_count: 1,
            token_usage_estimate: null,
            error_summary: null,
            is_pinned: true,
            learning_prompt: null,
          }),
        });
      }
      if (url.endsWith("/sources/1/retention") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 1,
            run_id: 7,
            url: "https://github.com/search?q=RAG",
            title: "RAG repositories",
            site: "github.com",
            language: "en",
            published_at: null,
            status: "success",
            status_reason: null,
            snippet: null,
            extracted_text: "RAG material",
            content_hash: "hash",
            quality_score: 1,
            is_pinned: true,
          }),
        });
      }
      if (url.endsWith("/sources/7/retention") && init?.method === "PATCH") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 7,
            run_id: 7,
            url: "https://github.com/search?q=RAG",
            title: "RAG repositories",
            site: "github.com",
            language: "en",
            published_at: null,
            status: "success",
            status_reason: null,
            snippet: null,
            extracted_text: "RAG material",
            content_hash: "hash",
            quality_score: 1,
            is_pinned: true,
          }),
        });
      }
      if (url.endsWith("/sources/1/clear-text") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 1,
            run_id: 7,
            url: "https://github.com/search?q=RAG",
            title: "RAG repositories",
            site: "github.com",
            language: "en",
            published_at: null,
            status: "success",
            status_reason: null,
            snippet: null,
            extracted_text: null,
            content_hash: null,
            quality_score: 1,
            is_pinned: true,
          }),
        });
      }
      if (url.endsWith("/sources/7/clear-text") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 7,
            run_id: 7,
            url: "https://github.com/search?q=RAG",
            title: "RAG repositories",
            site: "github.com",
            language: "en",
            published_at: null,
            status: "success",
            status_reason: null,
            snippet: null,
            extracted_text: null,
            content_hash: null,
            quality_score: 1,
            is_pinned: true,
          }),
        });
      }
      if (url.endsWith("/sources/1") && init?.method === "DELETE") {
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      if (url.endsWith("/sources/7") && init?.method === "DELETE") {
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) });
      }
      if (url.includes("/runs")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 7,
              knowledge_base_id: 1,
              keyword: "RAG",
              mode: "light",
              status: "partial",
              created_at: "2026-07-04T00:00:00Z",
              completed_at: null,
              language_policy: "zh-en-to-zh",
              source_count: 1,
              token_usage_estimate: null,
              error_summary: null,
              is_pinned: false,
              learning_prompt: null,
            },
          ],
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByText("API 0.1.0");

    await user.click(screen.getAllByRole("button", { name: "测试连接" })[0]);
    expect(await screen.findByText("模型连接成功（42ms）")).toBeInTheDocument();
    expect(screen.getByLabelText("关键词提炼")).toBeInTheDocument();
    await user.clear(screen.getByDisplayValue("我是初学者"));
    await user.type(screen.getByLabelText("知识库偏好"), "我是初学者，关注项目实战");
    await user.type(screen.getByLabelText("本次偏好"), "本次关注工具链");
    await user.click(screen.getByRole("button", { name: "保存学习偏好" }));
    expect(await screen.findByText("学习偏好已保存")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "AI 采集" }));
    expect(await screen.findByText("工具调用")).toBeInTheDocument();
    expect(screen.getByLabelText("AI 知识提炼")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "文章素材" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /AI 智能体 AI 采集总结/ }));
    const cardDialog = screen.getByRole("dialog", { name: "知识卡片详情" });
    expect(cardDialog).toBeInTheDocument();
    expect(within(cardDialog).getByText("已过滤重复内容")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭详情" }));
    await user.click(screen.getByRole("button", { name: /Agent guide/ }));
    const sourceDialog = screen.getByRole("dialog", { name: "素材详情" });
    expect(sourceDialog).toBeInTheDocument();
    expect(within(sourceDialog).getByText("Agent guide body")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "关闭详情" }));
    await user.click(screen.getByRole("button", { name: "全选待加入" }));
    expect(await screen.findByText("已选择 2 张待加入卡片")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "加入选中知识" }));
    expect(await screen.findByText("已将 2 张知识卡片加入图谱")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空本次搜索卡片" }));
    expect(await screen.findByText("已清空本次搜索卡片显示，历史记录仍会保留")).toBeInTheDocument();
    expect(screen.queryByText("工具调用")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "图谱" }));
    expect(screen.getByRole("heading", { name: "知识关系" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "运行" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关系探索" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "类型分组" })).toBeInTheDocument();
    await waitFor(() => {
      const graphInstances = (MockedGraph as unknown as { instances: Array<{ optionHistory: unknown[]; fitView: ReturnType<typeof vi.fn> }> }).instances;
      expect(graphInstances.length).toBeGreaterThan(0);
      const latestInstance = graphInstances[graphInstances.length - 1];
      const latestOptions = latestInstance.optionHistory[latestInstance.optionHistory.length - 1] as { behaviors?: unknown[] };
      expect(latestOptions.behaviors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "zoom-pinch", trigger: ["pinch"], type: "zoom-canvas" }),
        ]),
      );
    });
    await user.click(await screen.findByRole("button", { name: "RAG" }));
    expect(await screen.findByText("Retrieval augmented generation")).toBeInTheDocument();
    expect(screen.getByText("相关关系")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "搜索图谱节点" }), "检索");
    await user.selectOptions(screen.getByLabelText("节点类型筛选"), "concept");
    await user.click(screen.getByRole("button", { name: "返回概览" }));
    expect(await screen.findByText("已返回图谱整体结构")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜索图谱节点" })).toHaveValue("");
    expect(screen.getByLabelText("节点类型筛选")).toHaveValue("all");
    expect(screen.getByLabelText("关系深度")).toHaveValue("2");
    expect(screen.queryByText("Retrieval augmented generation")).not.toBeInTheDocument();
    await waitFor(() => {
      const graphInstances = (MockedGraph as unknown as { instances: Array<{ fitView: ReturnType<typeof vi.fn> }> }).instances;
      expect(graphInstances.some((instance) => instance.fitView.mock.calls.length > 0)).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "AI 助手" }));
    await user.type(screen.getByLabelText("AI 助手问题"), "我下一步应该学什么？");
    await user.click(screen.getByRole("button", { name: "提问" }));
    expect(await screen.findByText(/图谱内容：RAG 已有基础关系/)).toBeInTheDocument();
    expect(screen.getByText("RAG rerank guide")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/重排序/));
    await user.click(screen.getByRole("button", { name: "加入选中知识" }));
    expect(await screen.findByText("已将 1 张助手候选卡片加入图谱")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "新建关键点" })[0]);
    await user.type(screen.getByLabelText("关键点名称"), "向量检索");
    await user.selectOptions(screen.getByLabelText("关键点类型"), "skill");
    await user.type(screen.getByLabelText("关键点摘要"), "用于从向量库找相似内容");
    await user.type(screen.getByLabelText("关键点别名"), "Vector Search");
    await user.type(screen.getByLabelText("关键点标签"), "检索,实践");
    await user.click(screen.getByRole("button", { name: "保存关键点" }));
    expect(await screen.findByText("已创建关键点：向量检索")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑关键点" }));
    await user.clear(screen.getByLabelText("关键点摘要"));
    await user.type(screen.getByLabelText("关键点摘要"), "更新后的向量检索说明");
    await user.click(screen.getByRole("button", { name: "保存关键点" }));
    expect(await screen.findByText("已更新关键点：向量检索")).toBeInTheDocument();
    expect(await screen.findByText("更新后的向量检索说明")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除关键点" }));
    expect(await screen.findByText("已删除关键点：向量检索")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "历史" }));
    expect(screen.getByRole("heading", { name: "运行记录" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "筛选历史记录" }), "RAG");
    await user.click(screen.getByRole("button", { name: /RAG/ }));
    expect(await screen.findByText("RAG repositories")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "学习" }));
    await user.click(screen.getByRole("button", { name: "总结本次素材" }));
    expect(await screen.findByText("重排序")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "历史" }));
    await user.click(screen.getByRole("button", { name: "保留任务 7" }));
    expect(await screen.findByText("已保留任务 #7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保留来源 7" }));
    expect(await screen.findByText("已保留来源 #7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空正文 7" }));
    expect(await screen.findByText("已清空来源 #7 的正文")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除来源 7" }));
    expect(await screen.findByText("已删除来源 #7")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "知识库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建知识库" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText("模型连接成功（42ms）")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除知识库 机器人" }));
    expect(await screen.findByText("已删除知识库「机器人」")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新增来源" }));
    await user.clear(screen.getByLabelText(/来源名称 -/));
    await user.type(screen.getByLabelText(/来源名称 -/), "自定义源");
    await user.type(screen.getByLabelText(/来源 URL -/), "https://example.com/feed.xml");
    await user.click(screen.getByRole("button", { name: "保存来源设置" }));
    expect(await screen.findByText("已保存 2 个来源设置")).toBeInTheDocument();
    const sourceSaveCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/settings/sources") && init?.method === "PUT",
    );
    expect(sourceSaveCall).toBeDefined();
    const savedPayload = JSON.parse(String(sourceSaveCall?.[1]?.body));
    expect(savedPayload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          enabled: true,
          name: "自定义源",
          type: "rss",
          url_or_domain: "https://example.com/feed.xml",
        }),
      ]),
    );
    const modelTestCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/settings/model/test") && init?.method === "POST",
    );
    expect(modelTestCall).toBeDefined();
    expect(JSON.parse(String(modelTestCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        base_url: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
      }),
    );
    const runCreateCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/runs") && init?.method === "POST",
    );
    expect(JSON.parse(String(runCreateCall?.[1]?.body))).toEqual(
      expect.objectContaining({
        learning_prompt: "本次关注工具链",
      }),
    );
    const promptSaveCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/knowledge-bases/1") && init?.method === "PATCH",
    );
    expect(JSON.parse(String(promptSaveCall?.[1]?.body))).toEqual({
      learning_prompt: "我是初学者，关注项目实战",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/8/cards/approve",
      expect.objectContaining({
        body: JSON.stringify({ card_ids: [81, 82] }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/7/retention",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sources/7/clear-text",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sources/7",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/knowledge-bases/2",
      expect.objectContaining({ method: "DELETE" }),
    );
    const nodeCreateCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/knowledge/nodes") && init?.method === "POST",
    );
    expect(JSON.parse(String(nodeCreateCall?.[1]?.body))).toEqual({
      aliases: ["Vector Search"],
      knowledge_base_id: 1,
      name: "向量检索",
      summary: "用于从向量库找相似内容",
      tags: ["检索", "实践"],
      type: "skill",
    });
    const nodeUpdateCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/knowledge/nodes/3?knowledge_base_id=1") && init?.method === "PATCH",
    );
    expect(JSON.parse(String(nodeUpdateCall?.[1]?.body))).toEqual({
      aliases: ["Vector Search"],
      name: "向量检索",
      summary: "更新后的向量检索说明",
      tags: ["检索", "实践"],
      type: "skill",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/knowledge/nodes/3?knowledge_base_id=1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
