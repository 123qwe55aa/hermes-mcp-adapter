# Architecture

## Components

```text
MCP client
  |
  | stdio JSON-RPC
  v
Hermes MCP Adapter
  |-- tool registry
  |-- sandbox guards
  |-- audit logging
  |-- local filesystem/shell fallback
  |
  +--> Hermes HTTP runtime, optional
```

## Modes

### `HERMES_MODE=local`

The adapter performs safe filesystem and shell operations directly. This is useful for the first MVP because it avoids guessing Hermes' private API shape.

### `HERMES_MODE=http`

The adapter forwards calls to Hermes:

- `GET /health`
- `POST /fs/list` with `{ "path": "..." }`
- `POST /fs/read` with `{ "path": "..." }`
- `POST /shell/exec` with `{ "command": "...", "cwd": "..." }`

If your Hermes runtime uses different routes, update `src/hermes/client.ts`.

## Security boundaries

1. **Workspace boundary**: all paths are resolved under `WORKSPACE_ROOT`.
2. **Command boundary**: the first command token must be allowlisted.
3. **Dangerous pattern blocklist**: known foot-gun commands are rejected before execution.
4. **No public transport in MVP**: stdio only. Add remote transport later behind authentication.
5. **Audit log**: all tool starts, successes, and errors are written as JSON lines to stderr.

## Why this replaces DevSpace for the MVP

DevSpace bundles gateway, tunnel, auth, filesystem tools, shell tools, and UI together. This project keeps only the part you need first: a controllable MCP adapter with strict local boundaries.

Add tunnel/auth only after the local adapter is stable.
