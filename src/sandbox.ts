import path from "node:path";
import { config } from "./config.js";

const blockedCommandPatterns = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{/,
  /curl\b.*\|\s*(sh|bash)/i,
  /wget\b.*\|\s*(sh|bash)/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bchmod\s+777\b/i,
  /\bchown\b/i
];

export function resolveWorkspacePath(inputPath: string): string {
  const relative = inputPath.trim() || ".";
  const resolved = path.resolve(config.workspaceRoot, relative);
  const rootWithSeparator = config.workspaceRoot.endsWith(path.sep)
    ? config.workspaceRoot
    : `${config.workspaceRoot}${path.sep}`;

  if (resolved !== config.workspaceRoot && !resolved.startsWith(rootWithSeparator)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }

  return resolved;
}

export function assertSafeCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command cannot be empty");
  }

  if (blockedCommandPatterns.some((pattern) => pattern.test(trimmed))) {
    throw new Error(`Command blocked by sandbox policy: ${trimmed}`);
  }

  const firstToken = trimmed.split(/\s+/)[0];
  if (!config.commandAllowlist.includes(firstToken)) {
    throw new Error(
      `Command '${firstToken}' is not allowlisted. Allowed commands: ${config.commandAllowlist.join(", ")}`
    );
  }

  return trimmed;
}

export function audit(event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...payload
  });
  console.error(line);
}
