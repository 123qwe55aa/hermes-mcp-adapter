import { config } from "../config.js";

export interface HermesResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function fetchWithTimeout(url: URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.hermesHttpTimeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Hermes request timed out after ${config.hermesHttpTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function request<T>(endpoint: string, payload: unknown): Promise<T> {
  const url = new URL(endpoint, config.hermesBaseUrl);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`Hermes HTTP ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }

  return body as T;
}

export const hermesClient = {
  async health(): Promise<unknown> {
    const url = new URL("/health", config.hermesBaseUrl);
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Hermes health check failed: HTTP ${response.status}`);
    }
    return response.json().catch(() => ({ ok: true }));
  },

  listDir(path: string): Promise<unknown> {
    return request("/fs/list", { path });
  },

  readFile(path: string): Promise<unknown> {
    return request("/fs/read", { path });
  },

  runCommand(command: string, cwd: string): Promise<unknown> {
    return request("/shell/exec", { command, cwd });
  }
};
