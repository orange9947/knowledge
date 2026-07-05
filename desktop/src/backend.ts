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
    AILKG_CORS_ORIGINS: "http://localhost,http://127.0.0.1:5173,http://localhost:5173,null,capacitor://localhost",
  };
}

export function getBackendExecutablePath(resourcesPath: string): string {
  const executableName = process.platform === "win32" ? "ailkg-backend.exe" : "ailkg-backend";
  const candidatePaths = [
    join(resourcesPath, "backend", executableName),
    resolve(process.cwd(), "..", "backend", "dist", executableName),
    resolve(process.cwd(), "backend", "dist", executableName),
  ];
  return candidatePaths.find((candidatePath) => existsSync(candidatePath)) ?? candidatePaths[0];
}

export async function waitForHealth(apiBaseUrl: string, attempts = 80): Promise<void> {
  const healthUrl = normalizeHealthUrl(apiBaseUrl);
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // Keep polling until the sidecar has finished binding the socket.
    }
    await delay(250);
  }
  throw new Error(`本地后端启动超时：${healthUrl}`);
}

function waitForProcessFailure(backendProcess: ChildProcess, executablePath: string): Promise<never> {
  return new Promise((_, reject) => {
    backendProcess.once("error", (error) => {
      reject(new Error(`无法启动本地后端：${executablePath}（${error.message}）`));
    });
    backendProcess.once("exit", (code, signal) => {
      reject(new Error(`本地后端提前退出：${code ?? signal ?? "unknown"}`));
    });
  });
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
  try {
    await Promise.race([waitForHealth(apiBaseUrl), waitForProcessFailure(backendProcess, executablePath)]);
  } catch (error) {
    backendProcess.kill();
    throw error;
  }
  return { apiBaseUrl, process: backendProcess };
}
