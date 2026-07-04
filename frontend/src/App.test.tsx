import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
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
    expect(screen.getByRole("button", { name: "运行" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "知识库" })).toBeInTheDocument();
    expect(await screen.findByText("API 0.1.0")).toBeInTheDocument();
  });

  it("switches sidebar buttons to matching workspace panels", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
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
      if (url.endsWith("/knowledge-bases")) {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 1,
              name: "默认知识库",
              description: null,
              created_at: "2026-07-04T00:00:00Z",
              updated_at: "2026-07-04T00:00:00Z",
            },
          ],
        });
      }
      if (url.includes("/knowledge/graph")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            nodes: [
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
            ],
            edges: [],
          }),
        });
      }
      if (url.includes("/knowledge/nodes/1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 1,
            knowledge_base_id: 1,
            type: "keyword",
            name: "RAG",
            normalized_name: "rag",
            summary: "Retrieval augmented generation",
            aliases: [],
            tags: ["keyword"],
          }),
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
      if (url.endsWith("/sources/1") && init?.method === "DELETE") {
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
            },
          ],
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByText("API 0.1.0");

    await user.click(screen.getByRole("button", { name: "知识图谱" }));
    expect(screen.getByRole("heading", { name: "知识关系" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "运行" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "RAG" }));
    expect(await screen.findByText("Retrieval augmented generation")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "历史记录" }));
    expect(screen.getByRole("heading", { name: "运行记录" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "筛选历史记录" }), "RAG");
    await user.click(screen.getByRole("button", { name: /RAG/ }));
    expect(await screen.findByText("RAG repositories")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保留任务 7" }));
    expect(await screen.findByText("已保留任务 #7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保留来源 1" }));
    expect(await screen.findByText("已保留来源 #1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空正文 1" }));
    expect(await screen.findByText("已清空来源 #1 的正文")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除来源 1" }));
    expect(await screen.findByText("已删除来源 #1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "知识库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建知识库" })).toBeInTheDocument();
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
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/7/retention",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sources/1/clear-text",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sources/1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
