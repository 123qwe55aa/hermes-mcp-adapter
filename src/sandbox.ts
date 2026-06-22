import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export interface SafeCommand {
  command: string;
  file: string;
  args: string[];
}

const blockedCommandPatterns = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{/,
  /curl\b.*\|\s*(sh|bash|zsh|fish)/i,
  /wget\b.*\|\s*(sh|bash|zsh|fish)/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bchmod\s+777\b/i,
  /\bchown\b/i
];

const allowedGitSubcommands = new Set(["status", "diff", "log", "branch", "show", "rev-parse"]);
const allowedNpmSubcommands = new Set(["test", "run"]);
const forbiddenGitArgs = new Set(["-C", "-c", "--git-dir", "--work-tree", "--exec-path"]);

function rootWithSeparator(root: string): string {
  return root.endsWith(path.sep) ? root : `${root}${path.sep}`;
}

function splitCommand(command: string): SafeCommand {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command cannot be empty");
  }

  const parts = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const [file, ...args] = parts.map((part) => part.replace(/^["']|["']$/g, ""));
  if (!file) throw new Error("Command cannot be empty");

  return { command: trimmed, file, args };
}

function hasParentPathSegment(value: string): boolean {
  return value.replace(/\\/g, "/").split("/").includes("..");
}

function isHomePath(value: string): boolean {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\");
}

function assertNoExternalPathArgs(args: string[]): void {
  for (const arg of args) {
    if (path.isAbsolute(arg) || /^[A-Za-z]:[\\/]/.test(arg) || hasParentPathSegment(arg) || isHomePath(arg)) {
      throw new Error(`Command argument escapes workspace policy: ${arg}`);
    }
  }
}

function firstNonOption(args: string[]): { value: string; index: number } | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") return null;
    if (!arg.startsWith("-")) return { value: arg, index };
  }
  return null;
}

function assertGitPolicy(args: string[]): void {
  for (const arg of args) {
    if (forbiddenGitArgs.has(arg) || arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=") || arg.startsWith("--exec-path=")) {
      throw new Error(`Git argument is not allowed: ${arg}`);
    }
  }

  const subcommand = firstNonOption(args);
  if (!subcommand || !allowedGitSubcommands.has(subcommand.value)) {
    throw new Error(`Git subcommand is not allowlisted. Allowed: ${Array.from(allowedGitSubcommands).join(", ")}`);
  }
}

function assertNpmPolicy(args: string[]): void {
  const subcommand = firstNonOption(args);
  if (!subcommand || !allowedNpmSubcommands.has(subcommand.value)) {
    throw new Error(`npm subcommand is not allowlisted. Allowed: ${Array.from(allowedNpmSubcommands).join(", ")}`);
  }

  if (subcommand.value === "run") {
    const scriptName = args[subcommand.index + 1];
    if (!scriptName || scriptName.startsWith("-")) {
      throw new Error("npm run requires an allowlisted script name");
    }
    if (!/^[A-Za-z0-9:_-]+$/.test(scriptName) || !config.npmScriptAllowlist.includes(scriptName)) {
      throw new Error(`npm script '${scriptName}' is not allowlisted. Allowed scripts: ${config.npmScriptAllowlist.join(", ")}`);
    }
    if (args.length > subcommand.index + 2) {
      throw new Error("Extra npm run arguments are not allowed in the MVP sandbox");
    }
  }
}

export function resolveWorkspacePath(inputPath: string): string {
  const relative = inputPath.trim() || ".";
  const resolved = path.resolve(config.workspaceRoot, relative);

  if (resolved !== config.workspaceRoot && !resolved.startsWith(rootWithSeparator(config.workspaceRoot))) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }

  return resolved;
}

export async function resolveExistingWorkspacePath(inputPath: string): Promise<string> {
  const resolved = resolveWorkspacePath(inputPath);
  const [rootRealPath, resolvedRealPath] = await Promise.all([
    fs.realpath(config.workspaceRoot),
    fs.realpath(resolved)
  ]);

  if (resolvedRealPath !== rootRealPath && !resolvedRealPath.startsWith(rootWithSeparator(rootRealPath))) {
    throw new Error(`Path escapes workspace through symlink: ${inputPath}`);
  }

  return resolvedRealPath;
}

export function assertSafeCommand(command: string): SafeCommand {
  if (blockedCommandPatterns.some((pattern) => pattern.test(command))) {
    throw new Error(`Command blocked by sandbox policy: ${command}`);
  }

  const parsed = splitCommand(command);
  if (!config.commandAllowlist.includes(parsed.file)) {
    throw new Error(
      `Command '${parsed.file}' is not allowlisted. Allowed commands: ${config.commandAllowlist.join(", ")}`
    );
  }

  assertNoExternalPathArgs(parsed.args);

  if (parsed.file === "git") {
    assertGitPolicy(parsed.args);
  }

  if (parsed.file === "npm") {
    assertNpmPolicy(parsed.args);
  }

  return parsed;
}

export function audit(event: string, payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...payload
  });
  console.error(line);
}
