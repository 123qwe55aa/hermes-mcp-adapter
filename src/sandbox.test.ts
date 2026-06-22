import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-mcp-workspace-"));
const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-mcp-outside-"));

process.env.WORKSPACE_ROOT = workspaceRoot;
process.env.COMMAND_ALLOWLIST = "ls,pwd,rg,git,npm";
process.env.NPM_SCRIPT_ALLOWLIST = "test,typecheck,build,lint";

const sandbox = await import("./sandbox.js");
const localFs = await import("./local/fs.js");

test("blocks parent path traversal", () => {
  assert.throws(() => sandbox.resolveWorkspacePath("../outside"), /escapes workspace/);
});

test("blocks absolute paths outside the workspace", () => {
  assert.throws(() => sandbox.resolveWorkspacePath(path.join(outsideRoot, "secret.txt")), /escapes workspace/);
});

test("reads normal workspace files", async () => {
  await fs.writeFile(path.join(workspaceRoot, "note.txt"), "hello", "utf8");
  const result = await localFs.readFile("note.txt");
  assert.equal(result.content, "hello");
});

test("blocks symlinks that point outside the workspace", async (t) => {
  const outsideFile = path.join(outsideRoot, "secret.txt");
  const linkPath = path.join(workspaceRoot, "secret-link.txt");
  await fs.writeFile(outsideFile, "secret", "utf8");

  try {
    await fs.symlink(outsideFile, linkPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      t.skip("symlink creation is not permitted on this platform");
      return;
    }
    throw error;
  }

  await assert.rejects(() => localFs.readFile("secret-link.txt"), /Symlinks are not allowed|escapes workspace/);
});

test("allows narrow read-only git commands", () => {
  const command = sandbox.assertSafeCommand("git status --short");
  assert.equal(command.file, "git");
  assert.deepEqual(command.args, ["status", "--short"]);
});

test("rejects commands that are no longer allowlisted by default", () => {
  assert.throws(() => sandbox.assertSafeCommand("cat package.json"), /not allowlisted/);
  assert.throws(() => sandbox.assertSafeCommand("node -e console.log(process.env)"), /not allowlisted/);
  assert.throws(() => sandbox.assertSafeCommand("python3 -c print(1)"), /not allowlisted/);
});

test("rejects git workspace escape arguments", () => {
  assert.throws(() => sandbox.assertSafeCommand("git -C /tmp status"), /escapes workspace policy|not allowlisted|Git argument/);
  assert.throws(() => sandbox.assertSafeCommand("git --git-dir=/tmp/repo/.git status"), /Git argument|escapes workspace policy/);
});

test("rejects non-read-only git subcommands", () => {
  assert.throws(() => sandbox.assertSafeCommand("git commit -m test"), /Git subcommand is not allowlisted/);
});

test("restricts npm to test and allowlisted run scripts", () => {
  assert.equal(sandbox.assertSafeCommand("npm test").file, "npm");
  assert.equal(sandbox.assertSafeCommand("npm run build").file, "npm");
  assert.throws(() => sandbox.assertSafeCommand("npm install"), /npm subcommand is not allowlisted/);
  assert.throws(() => sandbox.assertSafeCommand("npm run arbitrary"), /npm script 'arbitrary' is not allowlisted/);
});

test("rejects absolute command arguments", () => {
  assert.throws(() => sandbox.assertSafeCommand("rg secret /etc/passwd"), /escapes workspace policy/);
});
