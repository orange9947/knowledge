import { contextBridge, ipcRenderer } from "electron";

type DesktopRuntime = {
  apiBaseUrl?: string;
  platform: "desktop";
};

function readRuntimeFromArguments(): DesktopRuntime {
  const apiBaseUrlPrefix = "--ailkg-api-base-url=";
  const apiBaseUrl = process.argv
    .find((argument) => argument.startsWith(apiBaseUrlPrefix))
    ?.slice(apiBaseUrlPrefix.length);
  return {
    apiBaseUrl,
    platform: "desktop",
  };
}

const runtime = readRuntimeFromArguments();

const desktopBridge = {
  getRuntime: async (): Promise<DesktopRuntime> => ipcRenderer.invoke("runtime:get") as Promise<DesktopRuntime>,
};

contextBridge.exposeInMainWorld("__AILKG_DESKTOP__", desktopBridge);
contextBridge.exposeInMainWorld("__AILKG_RUNTIME__", runtime);
