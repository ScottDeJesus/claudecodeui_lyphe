/**
 * The environment a process the server launches FOR THE USER inherits: the server's own, minus what
 * describes the server process itself and the process it was started from.
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

/**
 * A dispatched soul's mark. `PLAN_RUNNER_CHILD` and `PLAN_RUNNER_RUN_ID` say "this process is a soul the
 * dispatcher is walking for a plan" (`hooks/plan_runner/souls.py`), and `dispatcher stop` / `dispatcher park`
 * refuse a caller that carries them when the target is that soul's own plan, its arc or a sibling
 * (`hooks/dispatcher/soul_guard.py`). A server started from such a soul's shell would hand the mark to every
 * dispatcher verb it relays for the operator — the plan card's Pause among them — and his own press would
 * be refused as the soul's. Nothing under `server/` sets or reads either name; the plan runner stamps them
 * itself on the souls it launches.
 */
const DISPATCHED_SOUL_MARK = ['PLAN_RUNNER_CHILD', 'PLAN_RUNNER_RUN_ID'] as const;

/**
 * Consumers: every server module that launches a child for the user — the provider runtimes (claude, codex,
 * cursor, opencode), the Shell tab's terminal (`websocket`), the dispatcher and roadmap verbs the cards relay,
 * heal, compaction, jev, deepseek usage, browser-use, project clone, the agent routes and launcher, kanban-metis,
 * cerberus diagnosis and the settings switches. They share this one subtraction so no launcher forgets a name.
 * `extra` is applied AFTER it, so a caller that must state one of the removed names still can.
 */
export function userFacingEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [...SERVER_ONLY_VARIABLES, ...DISPATCHED_SOUL_MARK]) {
    delete env[name];
  }
  return { ...env, ...extra };
}
