import spawn from 'cross-spawn';

type GitCommandResult = {
  stdout: string;
  stderr: string;
};

/**
 * What a failed git command carries: the exit code and both streams ride on the Error so callers can classify it.
 * Used by git-repository.service.ts, which reads `stderr` to tell "not a git repository" from a real failure.
 */
export type GitCommandFailure = Error & {
  code?: number | null;
  stdout?: string;
  stderr?: string;
};

/**
 * Runs a command without a shell and resolves with both streams once it exits 0; any other exit rejects
 * with an Error that carries `code`, `stdout` and `stderr`.
 * Used by git.routes.ts for every git command its handlers run, and by git-repository.service.ts and
 * git-status.service.ts for the commands under the status and diff readers.
 */
export function spawnAsync(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error: GitCommandFailure = new Error(`Command failed: ${command} ${args.join(' ')}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}
