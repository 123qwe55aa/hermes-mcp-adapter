# Hermes MCP Adapter

A self-hosted MCP adapter that exposes a local Hermes runtime to MCP-compatible clients.

This project is intentionally small: it gives you a safer bridge between an AI client and your local machine without depending on DevSpace.

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
- `run_command` — run tightly allowlisted commands inside the workspace

## Safety model

This adapter is deny-by-default around dangerous operations:

- All filesystem access is restricted to `WORKSPACE_ROOT`.
- `.env` is loaded from the adapter project root when present, without overriding existing environment variables.
- `..` traversal and absolute paths outside the workspace are blocked.
- Symlinks are rejected by local filesystem tools to prevent workspace escape.
- Shell commands are checked against a narrow command allowlist and command-specific subcommand policy.
- Risky default tools such as `cat`, `node`, `python3`, `grep`, and `pnpm` are not allowlisted by default.
- Local child processes receive a minimal environment instead of inheriting all parent secrets.
- Hermes HTTP forwarding uses request timeouts.
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

Run the safety test suite:

```bash
npm test
```

## Environment variables

```bash
WORKSPACE_ROOT=/Users/toby/Documents/Projects
HERMES_BASE_URL=http://127.0.0.1:9119
HERMES_HTTP_TIMEOUT_MS=10000
HERMES_MODE=local
COMMAND_ALLOWLIST=ls,pwd,rg,git,npm
NPM_SCRIPT_ALLOWLIST=test,typecheck,build,lint
COMMAND_TIMEOUT_MS=20000
MAX_FILE_BYTES=262144
```

`HERMES_MODE=local` runs filesystem and command tools directly from the adapter.

`HERMES_MODE=http` validates the command and workspace-relative `cwd` locally, then forwards tool calls to Hermes HTTP endpoints. The default endpoint mapping is documented in `src/hermes/client.ts`; adjust it to match your Hermes runtime if needed.

## Command policy

The MVP command runner intentionally favors narrow commands over a general shell.

Default command policy:

- `ls`, `pwd`, and `rg` are allowed, but absolute paths, home paths, and `..` path segments are rejected.
- `git` is restricted to read-oriented subcommands: `status`, `diff`, `log`, `branch`, `show`, and `rev-parse`.
- `git -C`, `--git-dir`, `--work-tree`, `--exec-path`, and `-c` are blocked.
- `npm` is restricted to `npm test` and `npm run <script>`, where `<script>` must be in `NPM_SCRIPT_ALLOWLIST`.

Prefer adding dedicated MCP tools such as `git_status`, `git_diff`, `npm_test`, and `npm_build` before widening `run_command`.

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
3. Add dedicated git tools: `git_status`, `git_diff`, `git_commit`.
4. Add a task-loop tool: plan → execute → verify → fix.

## Security warning

Do not expose this process directly to the public internet. If you later add a remote transport, put it behind TLS, authentication, rate limits, and strict tool permissions.
