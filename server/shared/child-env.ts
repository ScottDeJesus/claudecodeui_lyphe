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
