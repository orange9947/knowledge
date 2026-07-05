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
    vi.restoreAllMocks();
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

  it("uses the local Android backend when running in Android WebView", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36",
    );

    expect(getRuntimeName()).toBe("android");
    expect(getApiBaseUrl()).toBe("http://127.0.0.1:43126");
  });
});
