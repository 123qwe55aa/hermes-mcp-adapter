#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config } from "./config.js";
import { hermesClient } from "./hermes/client.js";
import { listDir as listDirLocal, readFile as readFileLocal } from "./local/fs.js";
import { runCommand as runCommandLocal } from "./local/shell.js";
import { audit, resolveWorkspacePath } from "./sandbox.js";

function asText(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text
      }
    ]
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
    return asText({ ok: false, error: message });
  }
}

const server = new McpServer({
  name: config.name,
  version: config.version
});

server.registerTool(
  "health_check",
  {
    title: "Health Check",
    description: "Check adapter configuration and optional Hermes HTTP reachability.",
    inputSchema: {}
  },
  async () =>
    callTool("health_check", async () => {
      if (config.hermesMode === "http") {
        const hermes = await hermesClient.health();
        return {
          ok: true,
          adapter: config.name,
          mode: config.hermesMode,
          workspaceRoot: config.workspaceRoot,
          hermes
        };
      }

      return {
        ok: true,
        adapter: config.name,
        mode: config.hermesMode,
        workspaceRoot: config.workspaceRoot
      };
    })
);

server.registerTool(
  "list_dir",
  {
    title: "List Directory",
    description: "List files and directories under WORKSPACE_ROOT.",
    inputSchema: {
      path: z.string().default(".").describe("Workspace-relative directory path")
    }
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
      path: z.string().describe("Workspace-relative file path")
    }
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
    description: "Run an allowlisted command inside WORKSPACE_ROOT. Dangerous commands are blocked.",
    inputSchema: {
      command: z.string().describe("Command to execute. First token must be allowlisted."),
      cwd: z.string().default(".").describe("Workspace-relative working directory")
    }
  },
  async ({ command, cwd }) =>
    callTool("run_command", async () => {
      const resolvedCwd = resolveWorkspacePath(cwd);
      if (config.hermesMode === "http") {
        return hermesClient.runCommand(command, resolvedCwd);
      }
      return runCommandLocal(command, cwd);
    })
);

const transport = new StdioServerTransport();
await server.connect(transport);
