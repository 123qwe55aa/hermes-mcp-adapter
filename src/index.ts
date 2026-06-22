#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { runHttpServer } from "./server.js";
import { audit, isLocalHttpHost } from "./sandbox.js";
import { createMcpServer } from "./mcpServer.js";

// Fail-closed gate: HTTP transport must either bind localhost or have an auth token.
if (config.transport === "http" && !config.mcpAuthToken && !isLocalHttpHost(config.httpHost)) {
  throw new Error(
    "MCP_AUTH_TOKEN is required when TRANSPORT=http and HTTP_HOST is not 127.0.0.1. " +
    "Set MCP_AUTH_TOKEN to a secret token, or set HTTP_HOST=127.0.0.1 for local-only access."
  );
}

// Fail-closed gate: HTTP transport on non-localhost must have an explicit CORS origin.
if (config.transport === "http" && !config.allowedOrigin && !isLocalHttpHost(config.httpHost)) {
  throw new Error(
    "ALLOWED_ORIGIN is required when TRANSPORT=http and HTTP_HOST is not 127.0.0.1. " +
    "Set ALLOWED_ORIGIN to a specific origin (e.g., http://127.0.0.1:3000) or set HTTP_HOST=127.0.0.1 for local-only access."
  );
}

if (config.transport === "http") {
  await runHttpServer();
} else {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
