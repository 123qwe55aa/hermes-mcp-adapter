import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { assertSafeCommand, resolveWorkspacePath } from "../sandbox.js";

const execFileAsync = promisify(execFile);

function splitCommand(command: string): { file: string; args: string[] } {
  // MVP parser: intentionally simple. For complex commands, prefer npm scripts or a future pty runner.
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const [file, ...args] = parts.map((part) => part.replace(/^['"]|['"]$/g, ""));
  if (!file) throw new Error("Command cannot be empty");
  return { file, args };
}

export async function runCommand(
  command: string,
  cwdInput = "."
): Promise<{ command: string; cwd: string; stdout: string; stderr: string }> {
  const safeCommand = assertSafeCommand(command);
  const cwd = resolveWorkspacePath(cwdInput);
  const { file, args } = splitCommand(safeCommand);

  const result = await execFileAsync(file, args, {
    cwd,
    timeout: config.commandTimeoutMs,
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      // Avoid accidental interactive prompts.
      CI: process.env.CI ?? "1"
    }
  });

  return {
    command: safeCommand,
    cwd,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
