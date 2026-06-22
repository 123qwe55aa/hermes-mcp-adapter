import path from "node:path";

export type HermesMode = "local" | "http";

function intFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const defaultWorkspace = path.resolve(process.cwd());
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT ?? defaultWorkspace);

export const config = {
  name: "hermes-mcp-adapter",
  version: "0.1.0",
  workspaceRoot,
  hermesBaseUrl: process.env.HERMES_BASE_URL ?? "http://127.0.0.1:9119",
  hermesMode: (process.env.HERMES_MODE === "http" ? "http" : "local") as HermesMode,
  commandAllowlist: listFromEnv("COMMAND_ALLOWLIST", [
    "ls",
    "pwd",
    "cat",
    "grep",
    "rg",
    "git",
    "npm",
    "pnpm",
    "node",
    "python3"
  ]),
  commandTimeoutMs: intFromEnv("COMMAND_TIMEOUT_MS", 20_000),
  maxFileBytes: intFromEnv("MAX_FILE_BYTES", 256 * 1024)
};
