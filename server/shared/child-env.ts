/**
 * The environment a process the server launches FOR THE USER inherits: the server's own, minus what
 * describes the server process itself.
 *
 * The dev supervisor starts the API with `TSX_TSCONFIG_PATH` pointing at `server/tsconfig.json`
 * (`deploy/dev-supervisor/child.mjs`), because tsx's loader reads the server's path aliases from
 * it. Every Claude, Codex, Cursor and OpenCode session, the Shell tab's terminal, a clone, the
 * browser tool and the plan-runner verbs were started with the server's whole `process.env`, so
 * they all inherited it — and any `tsx` run inside them resolved `@/…` against the SERVER's folder.
 * Measured 2026-09-11: a plan runner started from a CloudCLI session ran a client probe through tsx
 * and died with `ERR_MODULE_NOT_FOUND '@/modules'`; the same probe passed with the repo's config.
 * A user's own project that uses `@/` aliases would have met the same wrong map in the terminal.
 */
const SERVER_ONLY_VARIABLES = ['TSX_TSCONFIG_PATH'] as const;

export function userFacingEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of SERVER_ONLY_VARIABLES) {
    delete env[name];
  }
  return { ...env, ...extra };
}

/**
 * The `PATH` a lane's command runs with when this process has none of its own: the three directories every login shell
 * falls back to, stated rather than left empty so a lookup can succeed instead of failing in a way that reads like the
 * command's fault. The dispatcher's verbs wake a daemon and arm calendar units, so they look up `systemctl --user` and
 * `systemd-run --user` on `PATH` — and this server's unit may have been handed none at all.
 */
const DEFAULT_CHILD_PATH = '/usr/local/bin:/usr/bin:/bin';

/**
 * The environment the lanes run the dispatcher and the plan-runner with: the server's own (`userFacingEnv`), minus the two
 * names that say WHOSE SESSION a command runs in. This server is nobody's Claude session, whatever shell it was started
 * from, and the dispatcher reads those names as exactly that:
 * - `accept` refuses inside a Claude session (the operator's press on a prompt this lane raised is his own, and must land),
 *   and so does every door that carries Kaylee's relay of his word — only this server and his terminal may write
 *   "the operator said";
 * - `tell` writes the session it finds onto the outing it queues, where a stray id would own the designer's next load;
 * - a promote pressed on the screen is the operator's own and queues a design owned by no session, which the app's own
 *   prompts reach.
 *
 * `path` is the `PATH` the command runs with: this process's own unless it has none.
 *
 * Used by the dispatcher and roadmap modules (their verbs and reads) and by dispatch-souls (a run resumed on his word),
 * which all run the same house commands under the same rule.
 */
export function sessionlessEnv(path: string = process.env.PATH ?? DEFAULT_CHILD_PATH): NodeJS.ProcessEnv {
  const env = userFacingEnv({ PATH: path });
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.DISPATCHER_SESSION;
  return env;
}
