# Query-token Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ChatGPT Apps authenticate HTTP MCP requests with `/mcp?token=<MCP_AUTH_TOKEN>` while retaining Bearer authentication.

**Architecture:** Add one exported authentication predicate beside the HTTP server, using Node's constant-time comparison for either credential source. Call it from the existing `/mcp` authentication gate and document the URL form.

**Tech Stack:** TypeScript, Node.js standard library, `node:test`.

---

### Task 1: Accept query-token authentication

**Files:**
- Modify: `src/http-auth.test.ts`
- Modify: `src/server.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing authentication tests**

Import `isHttpRequestAuthorized` from `server.ts` and assert that an empty configured token permits requests, matching Bearer or query credentials permit requests, and missing or incorrect credentials fail.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --test-name-pattern="HTTP request authentication"`

Expected: TypeScript build fails because `isHttpRequestAuthorized` is not exported.

- [ ] **Step 3: Implement the minimum authentication predicate**

Use `Buffer` plus `timingSafeEqual` with a length check. Read Bearer from the existing header and query auth from `url.searchParams.get("token")`; accept either match.

- [ ] **Step 4: Use the predicate in the existing gate**

Replace the direct Bearer string equality in `/mcp` with `isHttpRequestAuthorized(config.mcpAuthToken, authHeader, url.searchParams.get("token"))`. Keep the existing `401` body and pathname-only audit event.

- [ ] **Step 5: Document ChatGPT App setup**

Document `https://host/mcp?token=<MCP_AUTH_TOKEN>`, selecting `No Authentication`, and treating the complete URL as a secret. Keep the Bearer instructions for other clients.

- [ ] **Step 6: Verify GREEN and the full suite**

Run: `npm test && npm run typecheck`

Expected: both commands exit 0 with no failed tests or TypeScript errors.

- [ ] **Step 7: Review the diff**

Run: `git diff --check && git diff -- src/server.ts src/http-auth.test.ts README.md`

Expected: no whitespace errors; diff contains only query-token auth, tests, and documentation.
