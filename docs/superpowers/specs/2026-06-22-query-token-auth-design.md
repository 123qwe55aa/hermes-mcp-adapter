# Query-token authentication design

## Goal

Allow a ChatGPT App configured with `No Authentication` to authenticate to the HTTP MCP endpoint by embedding the existing `MCP_AUTH_TOKEN` in its server URL.

## Design

The `/mcp` endpoint will accept either the existing `Authorization: Bearer <token>` header or a `token=<token>` query parameter. Bearer authentication remains supported for compatibility. No new secret or configuration setting is introduced.

Token comparison will use a constant-time comparison after checking byte lengths. Missing and incorrect credentials will receive the existing JSON `401 unauthorized` response. Audit logging will continue to record only the pathname, never the query string or credential value.

Health endpoints and the informational `GET /mcp` probe retain their current behavior. Authentication applies to MCP protocol requests exactly where Bearer authentication is currently enforced.

## Security boundaries

- Public and non-loopback bindings still fail closed unless `MCP_AUTH_TOKEN` is configured.
- Only the exact `token` query parameter is accepted; no aliases are added.
- Documentation warns that URLs containing credentials are secrets and must not be committed, logged, or shared.
- Existing Bearer clients continue to work unchanged.

## Tests

Add focused tests for the authentication decision function:

- valid Bearer token is accepted;
- valid query token is accepted;
- missing credentials are rejected when a token is configured;
- incorrect Bearer and query tokens are rejected;
- authentication remains disabled when `MCP_AUTH_TOKEN` is empty.

Run the complete test and type-check commands after implementation.
