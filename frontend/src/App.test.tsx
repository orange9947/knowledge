import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
        if (
          url.endsWith("/settings/sources") ||
          url.endsWith("/runs") ||
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
    expect(screen.getByRole("button", { name: "Save model" })).toBeInTheDocument();
    expect(await screen.findByText("API 0.1.0")).toBeInTheDocument();
  });
});
