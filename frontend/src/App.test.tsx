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
              app_name: "AI Learning Knowledge Graph",
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
                name: "Default",
                description: "Default knowledge base",
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

    expect(screen.getByRole("heading", { name: "AI Learning Knowledge Graph" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Knowledge base" })).toBeInTheDocument();
    expect(await screen.findByText("API 0.1.0")).toBeInTheDocument();
  });

  it("switches sidebar buttons to matching workspace panels", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              status: "ok",
              app_name: "AI Learning Knowledge Graph",
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
                name: "Default",
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
                },
              ],
              cards: [],
            }),
          });
        }
        if (url.endsWith("/settings/sources") || url.includes("/runs")) {
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
              },
            ],
          });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }),
    );

    render(<App />);
    await screen.findByText("API 0.1.0");

    await user.click(screen.getByRole("button", { name: "Knowledge graph" }));
    expect(screen.getByRole("heading", { name: "知识关系" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "RAG" }));
    expect(await screen.findByText("Retrieval augmented generation")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByRole("heading", { name: "运行记录" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Filter history" }), "RAG");
    await user.click(screen.getByRole("button", { name: /RAG/ }));
    expect(await screen.findByText("RAG repositories")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "知识库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create base" })).toBeInTheDocument();
  });
});
