export type AppRuntimeName = "web" | "desktop" | "android";

export type AppRuntime = {
  apiBaseUrl?: string;
  platform?: AppRuntimeName;
};

const ANDROID_LOCAL_API_BASE_URL = "http://127.0.0.1:43126";

declare global {
  interface Window {
    __AILKG_RUNTIME__?: AppRuntime;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isAndroidRuntime(): boolean {
  return typeof navigator !== "undefined" && /\bAndroid\b/i.test(navigator.userAgent);
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
  if (getRuntimeName() === "android") {
    return ANDROID_LOCAL_API_BASE_URL;
  }
  return "/api";
}

export function getRuntimeName(): AppRuntimeName {
  return window.__AILKG_RUNTIME__?.platform ?? (isAndroidRuntime() ? "android" : "web");
}
