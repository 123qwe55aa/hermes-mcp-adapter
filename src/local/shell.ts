import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";
import { assertSafeCommand, resolveWorkspacePath } from "../sandbox.js";

const execFileAsync = promisify(execFile);

function commandEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    CI: "1",
    HOME: config.workspaceRoot
  };

  for (const key of ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }

  return env;
}

export async function runCommand(
  command: string,
  cwdInput = "."
): Promise<{ command: string; cwd: string; stdout: string; stderr: string }> {
  const safeCommand = assertSafeCommand(command);
  const cwd = resolveWorkspacePath(cwdInput);

  const result = await execFileAsync(safeCommand.file, safeCommand.args, {
    cwd,
    timeout: config.commandTimeoutMs,
    maxBuffer: 1024 * 1024,
    env: commandEnvironment()
  });

  return {
    command: safeCommand.command,
    cwd,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
