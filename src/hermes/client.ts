import { config } from "../config.js";

export interface HermesResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function request<T>(endpoint: string, payload: unknown): Promise<T> {
  const url = new URL(endpoint, config.hermesBaseUrl);
  const response = await fetch(url, {
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
    const response = await fetch(url);
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
