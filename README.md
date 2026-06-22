# Hermes MCP Adapter

A self-hosted MCP adapter that exposes a local Hermes runtime to MCP-compatible clients.

This project is intentionally small: it gives you a safe bridge between an AI client and your local machine without depending on DevSpace.

## Architecture

```text
ChatGPT / MCP client
        |
        | MCP over stdio
        v
Hermes MCP Adapter
        |
        | HTTP or local fallback
        v
Hermes runtime / local workspace
```

## MVP tools

- `health_check` — verify adapter + Hermes reachability
- `list_dir` — list files inside the configured workspace
- `read_file` — read UTF-8 text files inside the workspace
- `run_command` — run allowlisted commands inside the workspace

## Safety model

This adapter is deny-by-default around dangerous operations:

- All filesystem access is restricted to `WORKSPACE_ROOT`.
- `..` traversal and absolute paths outside the workspace are blocked.
- Shell commands are checked against an allowlist.
- Dangerous shell tokens such as `sudo`, `rm -rf`, `mkfs`, `dd`, fork bombs, and shell pipes to `bash` are blocked.
- Tool calls are logged to stderr for auditability.

## Quick start

```bash
cd hermes-mcp-adapter
cp .env.example .env
npm install
npm run build
npm start
```

For local development:

```bash
npm run dev
```

## Environment variables

```bash
WORKSPACE_ROOT=/Users/toby/Documents/Projects
HERMES_BASE_URL=http://127.0.0.1:9119
HERMES_MODE=local
COMMAND_ALLOWLIST=ls,pwd,cat,grep,rg,git,npm,pnpm,node,python3
COMMAND_TIMEOUT_MS=20000
MAX_FILE_BYTES=262144
```

`HERMES_MODE=local` runs filesystem and command tools directly from the adapter.

`HERMES_MODE=http` forwards tool calls to Hermes HTTP endpoints. The default endpoint mapping is documented in `src/hermes/client.ts`; adjust it to match your Hermes runtime if needed.

## MCP client config example

```json
{
  "mcpServers": {
    "hermes-mcp-adapter": {
      "command": "node",
      "args": ["/absolute/path/to/hermes-mcp-adapter/dist/index.js"],
      "env": {
        "WORKSPACE_ROOT": "/Users/toby/Documents/Projects",
        "HERMES_BASE_URL": "http://127.0.0.1:9119",
        "HERMES_MODE": "local"
      }
    }
  }
}
```

## Suggested next steps

1. Wire `HERMES_MODE=http` to your real Hermes API shape.
2. Add a write-file tool with explicit confirmation.
3. Add git tools: `git_status`, `git_diff`, `git_commit`.
4. Add a task-loop tool: plan → execute → verify → fix.

## Security warning

Do not expose this process directly to the public internet. If you later add a remote transport, put it behind TLS, authentication, rate limits, and strict tool permissions.
