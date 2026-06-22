import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { audit } from "./sandbox.js";

export async function runHttpServer(server: McpServer): Promise<void> {
  // Enforce auth when binding to a non-local address
  const isLocalHost =
    config.httpHost === "127.0.0.1" ||
    config.httpHost === "localhost" ||
    config.httpHost === "::1";
  if (!isLocalHost && !config.mcpAuthToken) {
    throw new Error(
      `MCP_AUTH_TOKEN is required when HTTP_HOST is not localhost (current: ${config.httpHost})`
    );
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID()
  });

  await server.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // CORS headers for MCP client
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Version, Session-Id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint — no sensitive info leaked in HTTP mode
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      const health = {
        ok: true,
        name: config.name,
        version: config.version,
        transport: "streamable-http",
        mode: config.hermesMode,
        workspaceConfigured: true
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
      return;
    }

    // MCP protocol endpoint
    if (url.pathname === "/mcp") {
      // Require Bearer token when MCP_AUTH_TOKEN is set
      if (config.mcpAuthToken) {
        const authHeader = req.headers["authorization"];
        if (!authHeader || authHeader !== `Bearer ${config.mcpAuthToken}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
          audit("http_auth", { status: "rejected", path: url.pathname });
          return;
        }
      }

      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        audit("http_handler", { status: "error", error: String(error) });
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(error) }));
        }
      }
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  httpServer.listen(config.httpPort, config.httpHost, () => {
    audit("http_server", {
      status: "start",
      host: config.httpHost,
      port: config.httpPort,
      endpoint: `/mcp`,
      transport: "streamable-http"
    });
    if (process.stdout.isTTY) {
      console.log(`MCP HTTP server listening on http://${config.httpHost}:${config.httpPort}/mcp`);
    }
  });
}
