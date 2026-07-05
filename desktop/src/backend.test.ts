import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";

import { buildBackendEnv, getBackendExecutablePath, normalizeHealthUrl, sqlitePath } from "./backend.js";

describe("desktop backend helpers", () => {
  it("builds backend environment paths inside Electron userData", () => {
    const userDataPath = resolve("/tmp/ailkg-user-data");
    const env = buildBackendEnv(userDataPath, 43125);

    expect(env.AILKG_PORT).toBe("43125");
    expect(env.AILKG_HOST).toBe("127.0.0.1");
    expect(env.AILKG_DATABASE_URL).toBe(`sqlite:///${sqlitePath(join(userDataPath, "knowledge.db"))}`);
    expect(env.AILKG_SECRET_FILE).toBe(join(userDataPath, "secrets.json"));
  });

  it("normalizes health URL", () => {
    expect(normalizeHealthUrl("http://127.0.0.1:43125")).toBe("http://127.0.0.1:43125/health");
  });

  it("normalizes Windows SQLite paths for SQLAlchemy URLs", () => {
    expect(sqlitePath(String.raw`C:\Users\orange\AppData\Roaming\ailkg\knowledge.db`)).toBe(
      "C:/Users/orange/AppData/Roaming/ailkg/knowledge.db",
    );
  });

  it("falls back to packaged backend resource path", () => {
    const resourcesPath = "/tmp/ailkg-resources";
    const executableName = process.platform === "win32" ? "ailkg-backend.exe" : "ailkg-backend";

    expect(getBackendExecutablePath(resourcesPath)).toBe(join(resourcesPath, "backend", executableName));
  });
});
