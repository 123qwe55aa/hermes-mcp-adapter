#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";
import { hermesClient } from "./hermes/client.js";
import { runHttpServer } from "./server.js";
import { listDir as listDirLocal, readFile as readFileLocal } from "./local/fs.js";
import { runCommand as runCommandLocal } from "./local/shell.js";
import { assertSafeCommand, audit, isLocalHttpHost, resolveExistingWorkspacePath } from "./sandbox.js";

// Fail-closed gates
if (config.transport === "http" && !config.mcpAuthToken && !isLocalHttpHost(config.httpHost)) {
  throw new Error(
    "MCP_AUTH_TOKEN is required when TRANSPORT=http and HTTP_HOST is not 127.0.0.1. " +
    "Set MCP_AUTH_TOKEN to a secret token, or set HTTP_HOST=127.0.0.1 for local-only access."
  );
}

if (config.transport === "http" && !config.allowedOrigin && !isLocalHttpHost(config.httpHost)) {
  throw new Error(
    "ALLOWED_ORIGIN is required when TRANSPORT=http and HTTP_HOST is not 127.0.0.1. " +
    "Set ALLOWED_ORIGIN to a specific origin (e.g., http://127.0.0.1:3000) or set HTTP_HOST=127.0.0.1 for local-only access."
  );
}

function asText(value: unknown, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

async function callTool<T>(event: string, fn: () => Promise<T>) {
  audit(event, { status: "start", mode: config.hermesMode });
  try {
    const result = await fn();
    audit(event, { status: "ok" });
    return asText(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit(event, { status: "error", error: message });
    return asText({ ok: false, error: message }, true);
  }
}

/**
 * Creates a fresh McpServer instance with all tools registered.
 * Called per-initialize-request in HTTP mode so each session gets its own server.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: config.name,
    version: config.version,
  });

  server.registerTool(
    "health_check",
    {
      title: "Health Check",
      description: "Check adapter configuration and optional Hermes HTTP reachability.",
      inputSchema: {},
    },
    async () =>
      callTool("health_check", async () => {
        const base = {
          ok: true,
          adapter: config.name,
          mode: config.hermesMode,
          transport: config.transport,
        };

        if (config.hermesMode === "http") {
          const hermes = await hermesClient.health();
          return { ...base, hermes };
        }

        return { ...base, workspaceRoot: config.workspaceRoot };
      })
  );

  server.registerTool(
    "list_dir",
    {
      title: "List Directory",
      description: "List files and directories under WORKSPACE_ROOT.",
      inputSchema: {
        path: z.string().default(".").describe("Workspace-relative directory path"),
      },
    },
    async ({ path }) =>
      callTool("list_dir", async () => {
        if (config.hermesMode === "http") {
          return hermesClient.listDir(path);
        }
        return listDirLocal(path);
      })
  );

  server.registerTool(
    "read_file",
    {
      title: "Read File",
      description: "Read a UTF-8 text file under WORKSPACE_ROOT.",
      inputSchema: {
        path: z.string().describe("Workspace-relative file path"),
      },
    },
    async ({ path }) =>
      callTool("read_file", async () => {
        if (config.hermesMode === "http") {
          return hermesClient.readFile(path);
        }
        return readFileLocal(path);
      })
  );

  server.registerTool(
    "run_command",
    {
      title: "Run Command",
      description:
        "Run an allowlisted command inside WORKSPACE_ROOT. The command binary and subcommands are policy-checked; risky tools and dangerous arguments are blocked.",
      inputSchema: {
        command: z.string().describe("Command to execute. First token and subcommands must be allowlisted."),
        cwd: z.string().default(".").describe("Workspace-relative working directory"),
      },
    },
    async ({ command, cwd }) =>
      callTool("run_command", async () => {
        const safeCommand = assertSafeCommand(command);
        const resolvedCwd = await resolveExistingWorkspacePath(cwd);
        if (config.hermesMode === "http") {
          return hermesClient.runCommand(safeCommand.command, resolvedCwd);
        }
        return runCommandLocal(safeCommand.command, resolvedCwd);
      })
  );

  return server;
}

if (config.transport === "http") {
  await runHttpServer(createMcpServer);
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
