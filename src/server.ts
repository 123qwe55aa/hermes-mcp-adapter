import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.js";
import { audit, isLocalHttpHost } from "./sandbox.js";
import { createMcpServer } from "./mcpServer.js";

const transports: Record<string, StreamableHTTPServerTransport> = {};

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const sessionIdHeader = req.headers["mcp-session-id"] ?? req.headers["session-id"] ?? "";
  const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

  if (req.method === "POST") {
    const body = await readJsonBody(req);

    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId) {
      transport = transports[sessionId];
      if (!transport) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        }));
        return;
      }
    } else if (body && isInitializeRequest(body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      transport.onclose = () => {
        const sid = transport?.sessionId;
        if (sid) delete transports[sid];
      };

      const server = createMcpServer();
      await server.connect(transport);

      // Store transport immediately (before handleRequest processes)
      // The session ID will be set by the SDK during handleRequest
      const storeAfterInit = async () => {
        const sid = transport?.sessionId;
        if (sid && !transports[sid]) {
          transports[sid] = transport!;
          audit("session_created", { sessionId: sid });
        }
      };
      // Monkey-patch to store after SDK generates session ID
      // We override handleRequest to intercept after initialization
      const origHandle = transport.handleRequest.bind(transport);
      transport.handleRequest = (async (req: any, res: any, parsedBody?: any) => {
        const result = await origHandle(req, res, parsedBody);
        await storeAfterInit();
        return result;
      }) as typeof transport.handleRequest;
    } else if (!sessionId && Object.keys(transports).length > 0) {
      // No session ID but non-initialize request - fallback to most recent transport
      // This handles ChatGPT sending second request without Mcp-Session-Id header
      const keys = Object.keys(transports);
      transport = transports[keys[keys.length - 1]];
    } else {
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

  if (req.method === "GET" || req.method === "DELETE") {
    if (!sessionId || !transports[sessionId]) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid or missing session ID" },
        id: null,
      }));
      return;
    }
    await transports[sessionId].handleRequest(req, res);
    return;
  }

  res.writeHead(405);
  res.end();
}

export async function runHttpServer(): Promise<void> {
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

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // CORS headers for MCP client
    const corsOrigin = config.allowedOrigin || "*";
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept, MCP-Version, Mcp-Session-Id, mcp-session-id, Session-Id"
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      const health = {
        ok: true,
        name: config.name,
        version: config.version,
        transport: "streamable-http",
        mode: config.hermesMode,
        workspaceConfigured: true,
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(health));
      return;
    }

    // MCP protocol endpoint
    if (url.pathname === "/mcp") {
      // GET /mcp - return basic info (ChatGPT may probe)
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          name: config.name,
          version: config.version,
          transport: "streamable-http",
          mode: config.hermesMode,
          message: "MCP endpoint ready. Use POST for JSON-RPC requests.",
        }));
        return;
      }

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
        await handleMcpRequest(req, res);
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
      endpoint: "/mcp",
      transport: "streamable-http",
    });
    if (process.stdout.isTTY) {
      console.log(`MCP HTTP server listening on http://${config.httpHost}:${config.httpPort}/mcp`);
    }
  });
}
