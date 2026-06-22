import http from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { audit, isLocalHttpHost } from "./sandbox.js";

export async function runHttpServer(createServer: () => McpServer): Promise<void> {
  if (!isLocalHttpHost(config.httpHost) && !config.mcpAuthToken) {
    throw new Error(
      `MCP_AUTH_TOKEN is required when HTTP_HOST is not localhost (current: ${config.httpHost})`
    );
  }

  if (!isLocalHttpHost(config.httpHost) && !config.allowedOrigin) {
    throw new Error(
      `ALLOWED_ORIGIN is required when HTTP_HOST is not localhost (current: ${config.httpHost}). ` +
      `Set ALLOWED_ORIGIN to a specific origin (e.g., http://127.0.0.1:3000) or '*' to allow all origins.`
    );
  }

  // Stateful session storage: maps sessionId → transport
  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : undefined;
  }

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    audit("http_request", { method: req.method, path: url.pathname, host: req.headers.host });

    // CORS headers
    const corsOrigin = config.allowedOrigin || "*";
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, MCP-Version, Mcp-Session-Id, mcp-session-id, Session-Id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, Mcp-Session-Id, Content-Type");

    res.on("finish", () => {
      audit("http_response", { method: req.method, path: url.pathname, status: res.statusCode });
    });

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        name: config.name,
        version: config.version,
        transport: "streamable-http",
        mode: config.hermesMode,
        workspaceConfigured: true,
      }));
      return;
    }

    // MCP endpoint
    if (url.pathname === "/mcp") {
      if (config.mcpAuthToken) {
        const authHeader = req.headers["authorization"];
        if (!authHeader || authHeader !== `Bearer ${config.mcpAuthToken}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
          audit("http_auth", { status: "rejected", path: url.pathname });
          return;
        }
      }

      // Read body for POST to determine session routing
      let body: unknown;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
          return;
        }
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      // Log request details
      audit("mcp_request", {
        method: req.method,
        hasSession: !!sessionId,
        sessionPrefix: sessionId ? sessionId.substring(0, 8) : "",
        contentType: req.headers["content-type"] || "",
        accept: req.headers["accept"] || "",
      });

      try {
        // POST: initialize or continue session
        if (req.method === "POST") {
          let transport: StreamableHTTPServerTransport | undefined;

          if (sessionId) {
            // Existing session — reuse transport
            transport = transports.get(sessionId);
            if (!transport) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32001, message: "Session not found" },
                id: null,
              }));
              return;
            }
          } else if (isInitializeRequest(body)) {
            // New initialize request — create transport + server
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (newSessionId) => {
                transports.set(newSessionId, transport!);
              },
            });
            transport.onclose = () => {
              const sid = transport?.sessionId;
              if (sid) transports.delete(sid);
            };
            const mcpServer = createServer();
            await mcpServer.connect(transport);
          } else {
            // Non-initialize without session — reject
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Bad Request: No valid session ID provided" },
              id: null,
            }));
            return;
          }

          await transport.handleRequest(req, res, body);
          return;
        }

        // GET / DELETE: require valid session
        if (req.method === "GET" || req.method === "DELETE") {
          if (!sessionId || !transports.has(sessionId)) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Invalid or missing session ID" },
              id: null,
            }));
            return;
          }
          await transports.get(sessionId)!.handleRequest(req, res);
          return;
        }

        // Unsupported method
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed" },
          id: null,
        }));
      } catch (error) {
        audit("http_handler", { status: "error", error: String(error) });
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: String(error) }, id: null }));
        }
      }
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  httpServer.listen(config.httpPort, config.httpHost, () => {
    audit("http_server", {
      status: "start",
      host: config.httpHost,
      port: config.httpPort,
      endpoint: "/mcp",
      transport: "streamable-http",
    });
    if (process.stdout.isTTY) {
      console.log(`MCP HTTP server listening on http://${config.httpHost}:${config.httpPort}/mcp`);
    }
  });
}
