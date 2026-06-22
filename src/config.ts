import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type HermesMode = "local" | "http";

function projectRootFromModule(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const moduleBase = path.basename(moduleDir);
  if (moduleBase === "src" || moduleBase === "dist") {
    return path.dirname(moduleDir);
  }
  return process.cwd();
}

function parseDotEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadDotEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = parseDotEnvValue(rawValue);
    }
  }
}

loadDotEnvFile(path.join(projectRootFromModule(), ".env"));

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
  transport: (process.env.TRANSPORT ?? "stdio") as "stdio" | "http",
  httpPort: intFromEnv("HTTP_PORT", 3000),
  mcpAuthToken: process.env.MCP_AUTH_TOKEN ?? "",
  commandAllowlist: listFromEnv("COMMAND_ALLOWLIST", ["ls", "pwd", "rg", "git", "npm"]),
  npmScriptAllowlist: listFromEnv("NPM_SCRIPT_ALLOWLIST", ["test", "typecheck", "build", "lint"]),
  commandTimeoutMs: intFromEnv("COMMAND_TIMEOUT_MS", 20_000),
  maxFileBytes: intFromEnv("MAX_FILE_BYTES", 256 * 1024),
  hermesHttpTimeoutMs: intFromEnv("HERMES_HTTP_TIMEOUT_MS", 10_000),
};
