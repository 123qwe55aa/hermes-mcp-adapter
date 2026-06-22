import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { audit, isLocalHttpHost } from "./sandbox.js";

export async function runHttpServer(server: McpServer): Promise<void> {
  // Enforce auth when binding to a non-local address
  if (!isLocalHttpHost(config.httpHost) && !config.mcpAuthToken) {
    throw new Error(
      `MCP_AUTH_TOKEN is required when HTTP_HOST is not localhost (current: ${config.httpHost})`
    );
  }

  // Enforce CORS origin restriction when binding to a non-local address
  if (!isLocalHttpHost(config.httpHost) && !config.allowedOrigin) {
    throw new Error(
      `ALLOWED_ORIGIN is required when HTTP_HOST is not localhost (current: ${config.httpHost}). ` +
      `Set ALLOWED_ORIGIN to a specific origin (e.g., http://127.0.0.1:3000) or '*' to allow all origins.`
    );
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID()
  });

  await server.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    audit("http_request", { method: req.method, path: url.pathname, host: req.headers.host });

    // CORS headers for MCP client
    const corsOrigin = config.allowedOrigin || "*";
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, MCP-Version, Mcp-Session-Id, mcp-session-id, Session-Id");

    res.on("finish", () => {
      audit("http_response", { method: req.method, path: url.pathname, status: res.statusCode });
    });

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

      // Log request details for debugging
      const sessionHeader = req.headers["mcp-session-id"] || "";
      audit("mcp_request", {
        method: req.method,
        hasSession: !!sessionHeader,
        sessionPrefix: sessionHeader ? sessionHeader.toString().substring(0, 8) : "",
        contentType: req.headers["content-type"] || "",
        accept: req.headers["accept"] || "",
      });

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
