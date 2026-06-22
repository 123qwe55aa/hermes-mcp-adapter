import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { resolveExistingWorkspacePath, resolveWorkspacePath } from "../sandbox.js";

async function assertNotSymlink(resolved: string, workspacePath: string): Promise<void> {
  const stat = await fs.lstat(resolved);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symlinks are not allowed: ${workspacePath}`);
  }
}

export async function listDir(workspacePath: string): Promise<Array<{ name: string; type: string; path: string }>> {
  const resolved = resolveWorkspacePath(workspacePath);
  await assertNotSymlink(resolved, workspacePath);

  const realPath = await resolveExistingWorkspacePath(workspacePath);
  const stat = await fs.stat(realPath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${workspacePath}`);
  }

  const entries = await fs.readdir(realPath, { withFileTypes: true });

  return entries.map((entry) => {
    const fullPath = path.join(resolved, entry.name);
    const relativePath = path.relative(config.workspaceRoot, fullPath) || ".";
    return {
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      path: relativePath
    };
  });
}

export async function readFile(workspacePath: string): Promise<{ path: string; content: string; bytes: number }> {
  const resolved = resolveWorkspacePath(workspacePath);
  await assertNotSymlink(resolved, workspacePath);

  const realPath = await resolveExistingWorkspacePath(workspacePath);
  const stat = await fs.stat(realPath);

  if (!stat.isFile()) {
    throw new Error(`Not a file: ${workspacePath}`);
  }

  if (stat.size > config.maxFileBytes) {
    throw new Error(`File is too large: ${stat.size} bytes > ${config.maxFileBytes}`);
  }

  const content = await fs.readFile(realPath, "utf8");
  return {
    path: path.relative(config.workspaceRoot, resolved) || ".",
    content,
    bytes: Buffer.byteLength(content, "utf8")
  };
}
