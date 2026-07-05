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
