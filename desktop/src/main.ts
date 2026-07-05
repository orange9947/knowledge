import { app, BrowserWindow, ipcMain } from "electron";
import isDev from "electron-is-dev";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { startBackend, type BackendHandle } from "./backend.js";

const currentDir = dirname(fileURLToPath(import.meta.url));

let backend: BackendHandle | null = null;

function getRendererIndexPath(): string {
  if (!isDev) {
    return join(process.resourcesPath, "frontend", "dist", "index.html");
  }
  return resolve(currentDir, "..", "..", "frontend", "dist", "index.html");
}

async function createWindow(): Promise<void> {
  const port = Number(process.env.AILKG_DESKTOP_PORT ?? "43125");
  const rendererDevUrl = process.env.AILKG_DESKTOP_RENDERER_URL;
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
      preload: join(currentDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--ailkg-api-base-url=${backend.apiBaseUrl}`],
    },
  });

  if (isDev && rendererDevUrl) {
    await window.loadURL(rendererDevUrl);
  } else {
    await window.loadFile(getRendererIndexPath());
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  backend?.process.kill();
});
