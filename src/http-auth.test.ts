import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLocalHttpHost } from "./sandbox.js";
import { isHttpRequestAuthorized } from "./server.js";

describe("HTTP transport fail-closed gate", () => {
  it("rejects non-localhost without auth", () => {
    const gate = (host: string, token: string): boolean =>
      !isLocalHttpHost(host) && !token;

    // Non-localhost without token → should reject (gate returns true = fail)
    assert.equal(gate("0.0.0.0", ""), true,
      "0.0.0.0 without token should trigger gate");
    assert.equal(gate("192.168.1.100", ""), true,
      "LAN IP without token should trigger gate");

    // Localhost variants without token → should pass (gate returns false)
    assert.equal(gate("127.0.0.1", ""), false,
      "127.0.0.1 without token should pass");
    assert.equal(gate("localhost", ""), false,
      "localhost without token should pass");
    assert.equal(gate("::1", ""), false,
      "::1 without token should pass");

    // Non-localhost WITH token → should pass
    assert.equal(gate("0.0.0.0", "secret"), false,
      "0.0.0.0 with token should pass");
  });
});

describe("HTTP request authentication", () => {
  it("accepts disabled, Bearer, or query-token authentication and rejects invalid credentials", () => {
    assert.equal(isHttpRequestAuthorized("", undefined, null), true);
    assert.equal(isHttpRequestAuthorized("secret", "Bearer secret", null), true);
    assert.equal(isHttpRequestAuthorized("secret", undefined, "secret"), true);
    assert.equal(isHttpRequestAuthorized("secret", undefined, null), false);
    assert.equal(isHttpRequestAuthorized("secret", "Bearer wrong", "wrong"), false);
  });
});
