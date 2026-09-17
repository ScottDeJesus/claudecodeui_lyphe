import spawn from 'cross-spawn';

/**
 * Whether a CLI starts and exits cleanly — `<cli> --version` for the provider auth checks.
 *
 * Asynchronous on purpose: the auth checks run on every new chat's model picker, and a
 * synchronous spawn froze the whole server (every streaming chat included) for as long as the
 * child took, up to its timeout. A missing binary reports through the child's `error` event, not
 * a throw, so both are read. A child still running at the deadline is killed outright
 * (SIGKILL): a version probe has nothing to clean up, and one that ignores SIGTERM would outlive
 * the check.
 */
export function commandRuns(command: string, args: string[], timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);
    function finish(ok: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    }
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}
