# Standalone Desktop and Android Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the app so desktop and Android both run independently with a local backend, local SQLite data, local model secrets, and device-specific UI.

**Architecture:** Desktop uses Electron to start a PyInstaller-packaged FastAPI sidecar, then loads the shared React UI against a loopback backend URL. Android uses Capacitor for the React UI and Chaquopy to embed Python, start the same FastAPI app on loopback, and store SQLite/secrets in app-private storage. The shared frontend reads its API base URL from runtime injection, environment variables, or the existing `/api` development fallback.

**Tech Stack:** FastAPI, Uvicorn, SQLite, PyInstaller, React, Vite, TypeScript, Electron, electron-builder, Capacitor Android, Chaquopy, Gradle, Vitest, pytest.

---

Related spec: `docs/superpowers/specs/2026-07-05-standalone-desktop-android-packaging-design.md`

## File Structure

- Create `backend/app/local_server.py`: reusable backend launcher for desktop and Android.
- Modify `backend/app/config.py`: parse CORS origins from env and keep current dev defaults.
- Create `backend/tests/test_local_server.py`: verify env parsing and local server config helpers.
- Modify `frontend/src/api.ts`: support runtime and build-time API base URL.
- Create `frontend/src/platform.ts`: platform/runtime helpers for injected backend URL and app runtime.
- Create `frontend/src/platform.test.ts`: unit tests for backend URL resolution.
- Modify `frontend/vite.config.ts`: set `base: "./"` for packaged static assets while keeping dev proxy.
- Modify `frontend/src/App.tsx` and `frontend/src/styles.css`: adapt shell, graph, assistant, forms, and mobile navigation.
- Modify `frontend/src/App.test.tsx`: verify injected API base and platform-safe rendering.
- Create `desktop/package.json`: Electron scripts and dependencies.
- Create `desktop/tsconfig.json`: Electron TypeScript build config.
- Create `desktop/src/main.ts`: Electron main process, backend sidecar lifecycle, window startup.
- Create `desktop/src/preload.ts`: inject runtime backend URL safely into the renderer.
- Create `desktop/src/backend.ts`: backend process spawn, port choice, health polling.
- Create `desktop/src/backend.test.ts`: Node tests for backend helper logic.
- Create `backend/pyinstaller.spec`: backend sidecar packaging spec.
- Modify root `package.json`: add desktop, Android, and packaging scripts.
- Modify `frontend/package.json`: add Capacitor dependencies and scripts.
- Create `frontend/capacitor.config.ts`: Capacitor app metadata and web directory.
- Generate `frontend/android/` with `npx cap add android`: Android wrapper project.
- Modify `frontend/android/app/build.gradle`: apply Chaquopy and include Python requirements.
- Create `frontend/android/app/src/main/java/com/orange/ailkg/MainActivity.java`: starts local backend before loading WebView.
- Create `frontend/android/app/src/main/python/android_server.py`: Python bridge that starts FastAPI in a background thread.
- Create `frontend/android/app/src/main/res/xml/network_security_config.xml`: allow loopback cleartext only.
- Modify `frontend/android/app/src/main/AndroidManifest.xml`: add Internet permission, config, app metadata.
- Create `scripts/verify-packaging.sh`: run core packaging verification commands that are available on the current machine.
- Modify `README.md`: add standalone desktop/Android usage notes and known Android build constraints.

## Task 1: Backend Local Server Entrypoint

**Files:**
- Create: `backend/app/local_server.py`
- Modify: `backend/app/config.py`
- Test: `backend/tests/test_local_server.py`

- [ ] **Step 1: Add failing tests for CORS env parsing and local server settings**

Create `backend/tests/test_local_server.py`:

```python
import importlib

from app.config import Settings


def test_settings_reads_cors_origins_from_env_string(monkeypatch):
    monkeypatch.setenv(
        "AILKG_CORS_ORIGINS",
        "http://localhost, http://127.0.0.1, capacitor://localhost",
    )

    settings = Settings()

    assert settings.cors_origins == [
        "http://localhost",
        "http://127.0.0.1",
        "capacitor://localhost",
    ]


def test_local_server_builds_sqlite_database_url(tmp_path, monkeypatch):
    monkeypatch.setenv("AILKG_DATA_DIR", str(tmp_path))
    local_server = importlib.import_module("app.local_server")

    settings = local_server.build_local_server_settings(port=43125)

    assert settings.host == "127.0.0.1"
    assert settings.port == 43125
    assert settings.database_url == f"sqlite:///{tmp_path / 'knowledge.db'}"
    assert settings.secret_file == tmp_path / "secrets.json"
```

- [ ] **Step 2: Run the backend test and verify it fails**

Run:

```bash
cd backend && pytest tests/test_local_server.py -v
```

Expected: fails because `app.local_server` does not exist and `Settings` does not parse comma-separated `AILKG_CORS_ORIGINS`.

- [ ] **Step 3: Implement configurable CORS origins**

Modify `backend/app/config.py` so the class becomes:

```python
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AI 学习知识图谱"
    app_version: str = "0.1.0"
    database_url: str = "sqlite:///./data/knowledge.db"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    model_config = SettingsConfigDict(env_prefix="AILKG_", env_file=".env")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


def ensure_sqlite_parent(database_url: str) -> None:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        return
    path = database_url.removeprefix(prefix)
    if path in (":memory:", ""):
        return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 4: Implement local server helpers**

Create `backend/app/local_server.py`:

```python
from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

import uvicorn


@dataclass(frozen=True)
class LocalServerSettings:
    host: str
    port: int
    data_dir: Path
    database_url: str
    secret_file: Path


def build_local_server_settings(port: int | None = None) -> LocalServerSettings:
    data_dir = Path(os.environ.get("AILKG_DATA_DIR", "data")).expanduser().resolve()
    database_url = os.environ.get("AILKG_DATABASE_URL", f"sqlite:///{data_dir / 'knowledge.db'}")
    secret_file = Path(os.environ.get("AILKG_SECRET_FILE", data_dir / "secrets.json")).expanduser().resolve()
    return LocalServerSettings(
        host=os.environ.get("AILKG_HOST", "127.0.0.1"),
        port=port or int(os.environ.get("AILKG_PORT", "8000")),
        data_dir=data_dir,
        database_url=database_url,
        secret_file=secret_file,
    )


def apply_local_server_environment(settings: LocalServerSettings) -> None:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["AILKG_DATABASE_URL"] = settings.database_url
    os.environ["AILKG_SECRET_FILE"] = str(settings.secret_file)


def run_local_server(port: int | None = None) -> None:
    settings = build_local_server_settings(port)
    apply_local_server_environment(settings)
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False, access_log=False)


def start_local_server_thread(port: int | None = None) -> threading.Thread:
    thread = threading.Thread(target=run_local_server, kwargs={"port": port}, daemon=True)
    thread.start()
    return thread


if __name__ == "__main__":
    run_local_server()
```

- [ ] **Step 5: Run backend local server tests**

Run:

```bash
cd backend && pytest tests/test_local_server.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Run full backend suite**

Run:

```bash
npm run test:backend
```

Expected: all backend tests pass.

- [ ] **Step 7: Commit backend local server work**

Run:

```bash
git add backend/app/config.py backend/app/local_server.py backend/tests/test_local_server.py
git commit -m "feat: add local backend server entrypoint"
```

## Task 2: Frontend Runtime API Base

**Files:**
- Create: `frontend/src/platform.ts`
- Create: `frontend/src/platform.test.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Add platform URL resolution tests**

Create `frontend/src/platform.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { getApiBaseUrl, getRuntimeName } from "./platform";

declare global {
  interface Window {
    __AILKG_RUNTIME__?: {
      apiBaseUrl?: string;
      platform?: "web" | "desktop" | "android";
    };
  }
}

describe("platform helpers", () => {
  afterEach(() => {
    delete window.__AILKG_RUNTIME__;
    vi.unstubAllEnvs();
  });

  it("uses runtime injected API URL first", () => {
    window.__AILKG_RUNTIME__ = {
      apiBaseUrl: "http://127.0.0.1:43125",
      platform: "desktop",
    };

    expect(getApiBaseUrl()).toBe("http://127.0.0.1:43125");
    expect(getRuntimeName()).toBe("desktop");
  });

  it("falls back to Vite env API URL", () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:51234/");

    expect(getApiBaseUrl()).toBe("http://127.0.0.1:51234");
  });

  it("falls back to development proxy path", () => {
    expect(getApiBaseUrl()).toBe("/api");
    expect(getRuntimeName()).toBe("web");
  });
});
```

- [ ] **Step 2: Run the platform test and verify it fails**

Run:

```bash
npm --prefix frontend test -- --run src/platform.test.ts
```

Expected: fails because `frontend/src/platform.ts` does not exist.

- [ ] **Step 3: Implement platform helpers**

Create `frontend/src/platform.ts`:

```ts
export type AppRuntimeName = "web" | "desktop" | "android";

export type AppRuntime = {
  apiBaseUrl?: string;
  platform?: AppRuntimeName;
};

declare global {
  interface Window {
    __AILKG_RUNTIME__?: AppRuntime;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getApiBaseUrl(): string {
  const runtimeUrl = window.__AILKG_RUNTIME__?.apiBaseUrl?.trim();
  if (runtimeUrl) {
    return trimTrailingSlash(runtimeUrl);
  }
  const envUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (envUrl) {
    return trimTrailingSlash(envUrl);
  }
  return "/api";
}

export function getRuntimeName(): AppRuntimeName {
  return window.__AILKG_RUNTIME__?.platform ?? "web";
}
```

- [ ] **Step 4: Update API requests to use the runtime base**

Modify the request function in `frontend/src/api.ts`:

```ts
import { getApiBaseUrl } from "./platform";
```

Replace:

```ts
const response = await fetch(`/api${path}`, {
```

with:

```ts
const response = await fetch(`${getApiBaseUrl()}${path}`, {
```

- [ ] **Step 5: Make Vite assets package-friendly**

Modify `frontend/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
```

- [ ] **Step 6: Add an App test for injected API base**

Add this test to `frontend/src/App.test.tsx`:

```ts
it("uses injected runtime API base URL", async () => {
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
  delete window.__AILKG_RUNTIME__;
});
```

- [ ] **Step 7: Run frontend tests and build**

Run:

```bash
npm run test:frontend
npm run build:frontend
```

Expected: frontend tests and production build pass.

- [ ] **Step 8: Commit frontend runtime API work**

Run:

```bash
git add frontend/src/platform.ts frontend/src/platform.test.ts frontend/src/api.ts frontend/vite.config.ts frontend/src/App.test.tsx
git commit -m "feat: support packaged runtime api base"
```

## Task 3: Desktop Electron Shell

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/tsconfig.json`
- Create: `desktop/src/backend.ts`
- Create: `desktop/src/main.ts`
- Create: `desktop/src/preload.ts`
- Create: `desktop/src/backend.test.ts`
- Create: `backend/pyinstaller.spec`
- Modify: `package.json`

- [ ] **Step 1: Add desktop backend helper tests**

Create `desktop/src/backend.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildBackendEnv, normalizeHealthUrl } from "./backend";

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
});
```

- [ ] **Step 2: Create Electron package config**

Create `desktop/package.json`:

```json
{
  "name": "ai-learning-knowledge-graph-desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "npm run build && electron .",
    "test": "vitest --run",
    "dist": "npm run build && electron-builder"
  },
  "dependencies": {
    "electron-is-dev": "^3.0.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "electron": "^33.2.1",
    "electron-builder": "^25.1.8",
    "typescript": "^5.7.2",
    "vitest": "^4.1.9"
  },
  "build": {
    "appId": "com.orange.ailkg",
    "productName": "AI 学习知识图谱",
    "files": [
      "dist/**/*",
      "../frontend/dist/**/*"
    ],
    "extraResources": [
      {
        "from": "../backend/dist/ailkg-backend",
        "to": "backend/ailkg-backend"
      }
    ]
  }
}
```

Create `desktop/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Implement desktop backend helpers**

Create `desktop/src/backend.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type BackendHandle = {
  apiBaseUrl: string;
  process: ChildProcess;
};

export function normalizeHealthUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/$/, "")}/health`;
}

export function buildBackendEnv(userDataPath: string, port: number): NodeJS.ProcessEnv {
  const dataDir = resolve(userDataPath);
  return {
    ...process.env,
    AILKG_HOST: "127.0.0.1",
    AILKG_PORT: String(port),
    AILKG_DATA_DIR: dataDir,
    AILKG_DATABASE_URL: `sqlite:///${join(dataDir, "knowledge.db")}`,
    AILKG_SECRET_FILE: join(dataDir, "secrets.json"),
    AILKG_CORS_ORIGINS: "http://localhost,capacitor://localhost",
  };
}

export function getBackendExecutablePath(resourcesPath: string): string {
  const packagedPath = join(resourcesPath, "backend", process.platform === "win32" ? "ailkg-backend.exe" : "ailkg-backend");
  if (existsSync(packagedPath)) return packagedPath;
  return resolve(process.cwd(), "..", "backend", "dist", process.platform === "win32" ? "ailkg-backend.exe" : "ailkg-backend");
}

export async function waitForHealth(apiBaseUrl: string, attempts = 80): Promise<void> {
  const healthUrl = normalizeHealthUrl(apiBaseUrl);
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error(`本地后端启动超时：${healthUrl}`);
}

export async function startBackend(userDataPath: string, resourcesPath: string, port: number): Promise<BackendHandle> {
  await mkdir(userDataPath, { recursive: true });
  const executablePath = getBackendExecutablePath(resourcesPath);
  const backendProcess = spawn(executablePath, [], {
    env: buildBackendEnv(userDataPath, port),
    stdio: "ignore",
    windowsHide: true,
  });
  const apiBaseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(apiBaseUrl);
  return { apiBaseUrl, process: backendProcess };
}
```

- [ ] **Step 4: Implement Electron preload**

Create `desktop/src/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__AILKG_DESKTOP__", {
  getRuntime: async () => ipcRenderer.invoke("runtime:get"),
});
```

- [ ] **Step 5: Implement Electron main process**

Create `desktop/src/main.ts`:

```ts
import { app, BrowserWindow, ipcMain } from "electron";
import isDev from "electron-is-dev";
import { join } from "node:path";

import { startBackend, type BackendHandle } from "./backend.js";

let backend: BackendHandle | null = null;

async function createWindow(): Promise<void> {
  const port = Number(process.env.AILKG_DESKTOP_PORT ?? "43125");
  backend = await startBackend(app.getPath("userData"), process.resourcesPath, port);

  ipcMain.handle("runtime:get", () => ({
    apiBaseUrl: backend?.apiBaseUrl,
    platform: "desktop",
  }));

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    title: "AI 学习知识图谱",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    await window.loadURL("http://127.0.0.1:5173");
  } else {
    await window.loadFile(join(__dirname, "..", "..", "frontend", "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  backend?.process.kill();
});
```

- [ ] **Step 6: Add PyInstaller spec**

Create `backend/pyinstaller.spec`:

```python
# -*- mode: python ; coding: utf-8 -*-

a = Analysis(
    ["app/local_server.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=["app.main", "app.models", "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ailkg-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
```

- [ ] **Step 7: Add root scripts**

Modify root `package.json` scripts:

```json
{
  "dev:backend": "cd backend && python -m uvicorn app.main:app --reload",
  "dev:frontend": "npm --prefix frontend run dev",
  "test:backend": "cd backend && pytest",
  "test:frontend": "npm --prefix frontend test -- --run",
  "test:desktop": "npm --prefix desktop test",
  "build:frontend": "npm --prefix frontend run build",
  "build:backend:desktop": "cd backend && pyinstaller pyinstaller.spec",
  "build:desktop": "npm run build:frontend && npm --prefix desktop run build",
  "dev:desktop": "npm run build:frontend && npm --prefix desktop run dev"
}
```

- [ ] **Step 8: Install desktop dependencies**

Run:

```bash
npm install --prefix desktop
```

Expected: `desktop/package-lock.json` is created.

- [ ] **Step 9: Run desktop tests and build**

Run:

```bash
npm --prefix desktop test
npm --prefix desktop run build
```

Expected: desktop tests and TypeScript build pass.

- [ ] **Step 10: Commit desktop shell work**

Run:

```bash
git add package.json desktop backend/pyinstaller.spec
git commit -m "feat: add standalone desktop shell"
```

## Task 4: Android Capacitor And Chaquopy Shell

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/capacitor.config.ts`
- Create/Modify: `frontend/android/**`

- [ ] **Step 1: Add Capacitor package scripts**

Modify `frontend/package.json` scripts and dependencies:

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "cap:sync": "npm run build && cap sync android",
    "android:build": "npm run cap:sync && cd android && ./gradlew assembleDebug"
  },
  "dependencies": {
    "@capacitor/android": "^7.0.0",
    "@capacitor/core": "^7.0.0",
    "@antv/g6": "^5.1.1",
    "@vitejs/plugin-react": "^4.3.4",
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.7"
  },
  "devDependencies": {
    "@capacitor/cli": "^7.0.0"
  }
}
```

Preserve existing devDependencies in the file while adding `@capacitor/cli`.

- [ ] **Step 2: Create Capacitor config**

Create `frontend/capacitor.config.ts`:

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.orange.ailkg",
  appName: "AI 学习知识图谱",
  webDir: "dist",
  server: {
    androidScheme: "http",
    cleartext: true,
  },
};

export default config;
```

- [ ] **Step 3: Install Capacitor and generate Android project**

Run:

```bash
npm install --prefix frontend
cd frontend && npx cap add android
```

Expected: `frontend/android/` is generated.

- [ ] **Step 4: Configure Android manifest**

Modify `frontend/android/app/src/main/AndroidManifest.xml` to include:

```xml
<uses-permission android:name="android.permission.INTERNET" />

<application
    android:networkSecurityConfig="@xml/network_security_config"
    android:usesCleartextTraffic="true">
</application>
```

Keep the Activity declarations generated by Capacitor.

- [ ] **Step 5: Add loopback network security config**

Create `frontend/android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
```

- [ ] **Step 6: Add Android Python bridge**

Create `frontend/android/app/src/main/python/android_server.py`:

```python
import os
import threading


_server_thread = None


def start(data_dir: str, port: int) -> None:
    global _server_thread
    if _server_thread and _server_thread.is_alive():
        return

    os.environ["AILKG_DATA_DIR"] = data_dir
    os.environ["AILKG_DATABASE_URL"] = f"sqlite:///{data_dir}/knowledge.db"
    os.environ["AILKG_SECRET_FILE"] = f"{data_dir}/secrets.json"
    os.environ["AILKG_HOST"] = "127.0.0.1"
    os.environ["AILKG_PORT"] = str(port)
    os.environ["AILKG_CORS_ORIGINS"] = "http://localhost,http://127.0.0.1,capacitor://localhost"

    from app.local_server import run_local_server

    _server_thread = threading.Thread(target=run_local_server, kwargs={"port": port}, daemon=True)
    _server_thread.start()
```

- [ ] **Step 7: Apply Chaquopy Gradle config**

Modify `frontend/android/app/build.gradle` to add the Chaquopy plugin and Python dependency install. The exact generated Gradle file may vary; add these sections without removing Capacitor-generated blocks:

```gradle
plugins {
    id 'com.android.application'
    id 'com.chaquo.python'
}

android {
    defaultConfig {
        minSdkVersion 24
        ndk {
            abiFilters "arm64-v8a", "x86_64"
        }
        python {
            pip {
                install "fastapi>=0.115.0"
                install "httpx>=0.27.0"
                install "pydantic>=2.8.0"
                install "pydantic-settings>=2.4.0"
                install "sqlalchemy>=2.0.0"
                install "uvicorn>=0.30.0"
            }
        }
    }
    sourceSets {
        main {
            python.srcDirs = ["src/main/python", "../../../backend"]
        }
    }
}
```

Modify the project-level Gradle plugin management so Chaquopy is available:

```gradle
plugins {
    id "com.chaquo.python" version "16.1.0" apply false
}
```

- [ ] **Step 8: Start Python backend from MainActivity**

Modify `frontend/android/app/src/main/java/com/orange/ailkg/MainActivity.java`:

```java
package com.orange.ailkg;

import android.os.Bundle;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int BACKEND_PORT = 43126;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(this));
        }
        Python.getInstance()
            .getModule("android_server")
            .callAttr("start", getFilesDir().getAbsolutePath(), BACKEND_PORT);
        super.onCreate(savedInstanceState);
    }
}
```

- [ ] **Step 9: Inject Android runtime URL into WebView**

Add a small inline script to `frontend/index.html` before the main module script:

```html
<script>
  if (window.Capacitor) {
    window.__AILKG_RUNTIME__ = {
      apiBaseUrl: "http://127.0.0.1:43126",
      platform: "android"
    };
  }
</script>
```

- [ ] **Step 10: Run Android build**

Run:

```bash
npm --prefix frontend run android:build
```

Expected: either `frontend/android/app/build/outputs/apk/debug/app-debug.apk` is produced, or Gradle reports a concrete Chaquopy dependency packaging error that must be fixed before completion.

- [ ] **Step 11: Commit Android shell work**

Run:

```bash
git add frontend/package.json frontend/package-lock.json frontend/capacitor.config.ts frontend/index.html frontend/android
git commit -m "feat: add standalone android shell"
```

## Task 5: Device UI Adaptation

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Add test coverage for mobile navigation labels**

Add to `frontend/src/App.test.tsx`:

```ts
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
      if (url.endsWith("/knowledge/graph")) return Promise.resolve({ ok: true, json: async () => ({ nodes: [], edges: [] }) });
      return Promise.resolve({ ok: true, json: async () => [] });
    }),
  );

  render(<App />);

  expect(await screen.findByRole("button", { name: "学习" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "图谱" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "历史" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Add runtime class to root shell**

In `frontend/src/App.tsx`, import:

```ts
import { getRuntimeName } from "./platform";
```

Inside the `App` component, compute:

```ts
const runtimeName = getRuntimeName();
```

Change the shell root:

```tsx
<div className={`app-shell runtime-${runtimeName}`}>
```

- [ ] **Step 3: Improve mobile and desktop layout CSS**

Append or update these rules in `frontend/src/styles.css`:

```css
.assistant-backdrop {
  position: fixed;
  inset: 0;
  z-index: 18;
  background: rgba(15, 23, 42, 0.24);
}

.graph-canvas {
  touch-action: none;
}

@media (max-width: 768px) {
  .app-shell {
    min-height: 100dvh;
    grid-template-columns: 1fr;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  .sidebar {
    position: sticky;
    top: 0;
    z-index: 15;
    height: auto;
    padding: 10px 12px;
    flex-direction: row;
    align-items: center;
    overflow-x: auto;
  }

  .nav-stack {
    display: grid;
    grid-auto-flow: column;
    gap: 8px;
  }

  .nav-button {
    width: auto;
    min-width: 52px;
    padding: 0 12px;
  }

  .workspace {
    min-width: 0;
    padding: 16px 12px calc(24px + env(safe-area-inset-bottom));
  }

  .graph-workbench,
  .detail-grid,
  .analysis-model-grid,
  .source-editor-row,
  .dashboard-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .graph-toolbar,
  .run-controls,
  .topbar,
  .topbar-actions {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
  }

  .graph-canvas {
    min-height: 58dvh;
  }

  .assistant-drawer {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: 100vw;
    height: min(86dvh, 760px);
    border-radius: 18px 18px 0 0;
    transform: translateY(104%);
  }

  .assistant-drawer.open {
    transform: translateY(0);
  }

  .assistant-drawer textarea {
    min-height: 120px;
  }
}

@media (max-width: 480px) {
  .brand-text {
    display: none;
  }

  .segmented {
    grid-template-columns: 1fr;
  }

  .source-editor-row input,
  .source-editor-row select,
  .source-editor-row button,
  .run-controls button,
  .topbar-actions button {
    width: 100%;
  }
}
```

- [ ] **Step 4: Add assistant backdrop behavior**

In the graph view JSX where `AssistantDrawer` is rendered, add:

```tsx
{assistantOpen ? <button className="assistant-backdrop" aria-label="关闭助手遮罩" onClick={() => setAssistantOpen(false)} /> : null}
```

Keep the drawer itself after the backdrop so it stays above the overlay.

- [ ] **Step 5: Run frontend verification**

Run:

```bash
npm run test:frontend
npm run build:frontend
```

Expected: tests and build pass.

- [ ] **Step 6: Commit UI adaptation work**

Run:

```bash
git add frontend/src/App.tsx frontend/src/styles.css frontend/src/App.test.tsx
git commit -m "feat: adapt ui for desktop and android shells"
```

## Task 6: Packaging Verification Script

**Files:**
- Create: `scripts/verify-packaging.sh`
- Modify: `package.json`

- [ ] **Step 1: Create verification script**

Create `scripts/verify-packaging.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

npm run test:backend
npm run test:frontend
npm run build:frontend

if [ -d desktop/node_modules ]; then
  npm --prefix desktop test
  npm --prefix desktop run build
else
  echo "Skipping desktop verification: desktop/node_modules is missing"
fi

if [ -d frontend/android ]; then
  npm --prefix frontend run cap:sync
  if [ -x frontend/android/gradlew ]; then
    (cd frontend/android && ./gradlew assembleDebug)
  else
    echo "Skipping Android Gradle build: gradlew is missing"
  fi
else
  echo "Skipping Android verification: frontend/android is missing"
fi
```

- [ ] **Step 2: Mark script executable**

Run:

```bash
chmod +x scripts/verify-packaging.sh
```

- [ ] **Step 3: Add root script**

Modify root `package.json` scripts:

```json
"verify:packaging": "./scripts/verify-packaging.sh"
```

- [ ] **Step 4: Run available verification**

Run:

```bash
npm run verify:packaging
```

Expected: backend tests, frontend tests, frontend build, and any available desktop/Android checks pass or print explicit skip messages for missing generated projects/dependencies.

- [ ] **Step 5: Commit verification script**

Run:

```bash
git add scripts/verify-packaging.sh package.json
git commit -m "chore: add packaging verification script"
```

## Task 7: Documentation And Usage Guide

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add standalone usage sections**

Modify `README.md` with these sections:

```md
## 独立运行封装

桌面端使用 Electron 启动本地 FastAPI 后端，数据保存在系统用户数据目录。安卓端使用 Capacitor 承载同一套前端，并通过 Chaquopy 在 App 内启动本地 Python/FastAPI 后端。

独立运行不需要自建服务器。抓取网页、模型连接测试、AI 阅读分析和 AI 助手仍然需要联网，因为它们要访问学习来源和模型 API。

### 桌面端开发运行

```bash
npm install --prefix desktop
npm run build:frontend
npm --prefix desktop run dev
```

### 桌面端后端打包

```bash
cd backend
pyinstaller pyinstaller.spec
```

### 安卓端调试包

```bash
npm install --prefix frontend
cd frontend
npx cap sync android
cd android
./gradlew assembleDebug
```

### 数据位置

桌面端数据位于系统用户数据目录。安卓端数据位于 App 私有目录。模型 API Key 写入本地 secrets 文件，不会写入导出的知识库 JSON。
```

- [ ] **Step 2: Run README grep check**

Run:

```bash
rg -n "独立运行封装|桌面端开发运行|安卓端调试包|数据位置" README.md
```

Expected: all headings are found.

- [ ] **Step 3: Commit documentation**

Run:

```bash
git add README.md
git commit -m "docs: add standalone packaging usage guide"
```

## Task 8: Final Integration And Push

**Files:**
- Inspect: all modified files
- No new files required

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run verify:packaging
```

Expected: all available checks pass. Any unavailable platform-specific check must be explicitly listed in the final answer with the reason.

- [ ] **Step 2: Inspect git status and recent commits**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected: working tree is clean and the packaging commits are on `master`.

- [ ] **Step 3: Push to GitHub**

Run:

```bash
git push origin master
```

Expected: push succeeds.

- [ ] **Step 4: Completion audit**

Verify against the original goal:

- Desktop shell exists and can start a local backend.
- Android shell exists and attempts to start an embedded local backend.
- UI has desktop and Android adaptation changes.
- Function coverage checklist from the spec is preserved.
- Four workstreams are represented in implementation or verification: Android packaging, desktop packaging, function verification, UI adaptation.
- Tests/builds have been run and results are recorded.

- [ ] **Step 5: Final response**

Report:

- commits created
- verification commands and results
- APK/desktop artifact paths if produced
- any Android Chaquopy dependency blocker if the Gradle build fails
- GitHub push result
