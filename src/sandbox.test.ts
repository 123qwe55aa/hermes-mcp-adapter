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
const localShell = await import("./local/shell.js");

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

test("blocks shell cwd symlink escape", async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-mcp-outside-cwd-"));
  const linkPath = path.join(workspaceRoot, "escape-link");
  try {
    await fs.symlink(outsideDir, linkPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return;
    }
    throw error;
  }
  await assert.rejects(
    () => localShell.runCommand("ls", "escape-link"),
    /escapes workspace/
  );
});

test("isLocalHttpHost returns true for 127.0.0.1", () => {
  assert.equal(sandbox.isLocalHttpHost("127.0.0.1"), true);
});

test("isLocalHttpHost returns true for localhost", () => {
  assert.equal(sandbox.isLocalHttpHost("localhost"), true);
});

test("isLocalHttpHost returns true for ::1", () => {
  assert.equal(sandbox.isLocalHttpHost("::1"), true);
});

test("isLocalHttpHost returns false for 0.0.0.0", () => {
  assert.equal(sandbox.isLocalHttpHost("0.0.0.0"), false);
});

test("isLocalHttpHost returns false for LAN IP", () => {
  assert.equal(sandbox.isLocalHttpHost("192.168.1.1"), false);
});
