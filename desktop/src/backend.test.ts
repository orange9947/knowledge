import { describe, expect, it } from "vitest";

import { buildBackendEnv, getBackendExecutablePath, normalizeHealthUrl } from "./backend.js";

describe("desktop backend helpers", () => {
  it("builds backend environment paths inside Electron userData", () => {
    const env = buildBackendEnv("/tmp/ailkg-user-data", 43125);

    expect(env.AILKG_PORT).toBe("43125");
    expect(env.AILKG_HOST).toBe("127.0.0.1");
    expect(env.AILKG_DATABASE_URL).toBe("sqlite:////tmp/ailkg-user-data/knowledge.db");
    expect(env.AILKG_SECRET_FILE).toBe("/tmp/ailkg-user-data/secrets.json");
  });

  it("normalizes health URL", () => {
    expect(normalizeHealthUrl("http://127.0.0.1:43125")).toBe("http://127.0.0.1:43125/health");
  });

  it("falls back to packaged backend resource path", () => {
    expect(getBackendExecutablePath("/tmp/ailkg-resources")).toMatch(/\/tmp\/ailkg-resources\/backend\/ailkg-backend(?:\.exe)?$/);
  });
});
