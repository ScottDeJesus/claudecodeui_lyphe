import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { writeFlagFile } from '@/modules/settings/index.js';
import { userFacingEnv } from '@/shared/child-env.js';
import { resolveMcpCommand } from '@/shared/mcp-command.js';

/**
 * Everything a spawned Metis child is handed: its environment, its argv, its one credential and
 * the flag file its own plan-runners will read.
 *
 * This module is a BUILDER and nothing else. It starts no process, sends no frame and decides no
 * lifecycle; the spawner does all three and calls in here for the two arrays. That is why the
 * API origin and the DeepSeek key arrive as ARGUMENTS — the only reader of the server's own
 * environment is the composition root, which resolves both once and passes them down.
 *
 * Consumers: `metis-spawn.service.ts` (the argv, the env and the flag file, at every spawn and
 * resume) and `kanban-metis.routes.ts` (the derived secret and the lease owner, recomputed on
 * demand rather than kept).
 */

/** The board's own switch files: one per board, under this host's state directory. */
const BOARD_FLAG_DIR = path.join(os.homedir(), '.claude', 'state', 'kanban-deepseek');

/**
 * The DeepSeek endpoint and the model name a Flash child runs on.
 *
 * `~/.claude/hooks/plan_runner/deepseek.py:56-57` is the canonical home of both, and these are
 * its values transcribed rather than a second opinion: that file's `BASE_URL` and `MODEL` are
 * what every plan-runner on this box already routes on. A drift here would point a board's Metis
 * at an endpoint that no other child on the host uses, and nothing would say so.
 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/anthropic';
export const DEEPSEEK_MODEL = 'deepseek-flash';

/** The model a board that is NOT on Flash launches on. There is no second Claude pin for Metis. */
export const METIS_CLAUDE_MODEL = 'opus';

/** Where one board's switch file lives. Exported so the spawner and a probe name the same path. */
export function boardFlagPath(boardId: string): string {
  return path.join(BOARD_FLAG_DIR, `${boardId}.flag`);
}

/**
 * The lease owner every build-lease verb of one session compares against: sixteen lowercase hex.
 *
 * DERIVED from the session id, never minted. A minted token lives only in the process that made
 * it, so a session that is resumed or re-adopted after a server restart would come back unable to
 * refresh the leases it already holds — and would then be reaped by its own stall rule, mid-build,
 * by a server that had simply forgotten it. The same sixteen characters are computed here, in the
 * guard, and by any later process that sees this session id at all.
 *
 * The shape (sixteen lowercase hex) is Descent's (`descent/mcp_server.py:298`); what is dropped is
 * its randomness.
 */
export function deriveLeaseOwner(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 16);
}

/**
 * The child's credential half: HMAC-SHA256(the app's signing secret, sessionId), as hex.
 *
 * The secret is never stored and never sent as itself — the child carries `<sessionId>.<digest>`
 * and the guard recomputes this same digest on demand. That is what makes a credential that
 * outlives a restart: nothing has to be remembered for a live session's next tool call to be
 * accepted, and a session that leaves `running` stops being accepted without anything being
 * erased. A map in memory would empty on restart and 401 every live Metis mid-build.
 */
export function deriveMetisSecret(appSecret: string, sessionId: string): string {
  return crypto.createHmac('sha256', appSecret).update(sessionId).digest('hex');
}

/** The bearer one child sends, and the guard splits back apart: the id it claims, then its proof. */
export function metisBearer(appSecret: string, sessionId: string): string {
  return `${sessionId}.${deriveMetisSecret(appSecret, sessionId)}`;
}

/**
 * The ONE turn the child is handed on stdin, with the board id substituted and nothing else.
 *
 * `claude -p` with nothing written to stdin waits for input forever — the brief is the system
 * prompt, not a turn — so this string is what makes the child start working at all. It is
 * recorded VERBATIM in the session's `spec.json`, both so a reader months later knows what she
 * was actually asked and so a resume sends the same words (`souls.py:310-312` writes the prompt
 * to stdin and then closes it for exactly this reason).
 */
export function metisOpeningTurn(boardId: string): string {
  return `Work board \`${boardId}\`. Call \`list_actionable\`, take the top claimable card, and end the turn when nothing is claimable.`;
}

/** Which endpoint and which `--model` a board's switch buys. Settled at spawn, never re-derived. */
export function metisRouteFor(deepseekFlash: boolean): { provider: 'deepseek' | 'claude'; model: string } {
  return deepseekFlash
    ? { provider: 'deepseek', model: DEEPSEEK_MODEL }
    : { provider: 'claude', model: METIS_CLAUDE_MODEL };
}

/** Everything one spawn needs, as the spawner hands it over: identity, route, origin and secrets. */
export type MetisChildSpec = {
  boardId: string;
  sessionId: string;
  /** `deepseek-flash` or `opus` — the `--model` value, already settled by `metisRouteFor`. */
  model: string;
  /** The board's own switch, read from the board row at this spawn. */
  deepseekFlash: boolean;
  provider: 'deepseek' | 'claude';
  /** The running server's own origin, resolved once by the composition root. */
  apiOrigin: string;
  /** The app's JWT signing secret, from which this child's bearer is derived. */
  appSecret: string;
  /** The DeepSeek key, read by the composition root's reader. `null` when none is configured. */
  deepseekKey: string | null;
  /** The composed brief, handed as one `--append-system-prompt` string. */
  appendSystemPrompt: string;
  /** The board's own project path, or `null` for a board that names no project. */
  addDir: string | null;
  /** `true` to CONTINUE an existing conversation, `false` to mint one. Never both, never neither. */
  resume: boolean;
};

/**
 * The child's environment: the server's own, minus what describes the server process, plus what
 * describes this child.
 *
 * `userFacingEnv` is the subtraction, and it is not cosmetic: measured 2026-09-11, a plan-runner
 * started from a CloudCLI session inherited the server's `TSX_TSCONFIG_PATH`, ran a client probe
 * through `tsx`, and died with `ERR_MODULE_NOT_FOUND '@/modules'` because every `@/…` resolved
 * against the SERVER's folder. A Metis who starts plan-runners is exactly that path, so this
 * module composes the child's environment out of that helper and never out of a fresh copy of
 * the server's own.
 *
 * The DeepSeek pair is the one thing that is REMOVED after composition rather than merely not
 * added. A child on Claude must not inherit an endpoint the server itself happens to carry — the
 * server can be running on Flash — and a delete that only touched the additions would leave that
 * one in place, because the composition starts from the server's environment and lets the
 * additions win.
 */
export function buildMetisEnv(spec: MetisChildSpec): NodeJS.ProcessEnv {
  const extra: NodeJS.ProcessEnv = {
    // The shelves loader's own bypass (`souls.py:186-202`): a Metis is a NEW session, so the
    // operator's shell shelves are not hers to load.
    MAIN_SHELVES_LOADER_DISABLE: '1',
    KANBAN_METIS_BOARD_ID: spec.boardId,
    KANBAN_METIS_SESSION_ID: spec.sessionId,
    // The board's OWN switch, never the host-wide one: `deepseek.py`'s `flag_path()` reads this
    // variable at call time, so every plan-runner the child starts asks this board's file.
    PLAN_RUNNER_DEEPSEEK_FLAG_PATH: boardFlagPath(spec.boardId),
    // The brief is the same for every board; what is true of ONE project arrives as that
    // project's `CLAUDE.md`. The project reaches the child as `--add-dir`, not as its cwd, and the
    // CLI reads a `CLAUDE.md` out of an added directory only when this is set.
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1',
  };

  if (spec.deepseekFlash) {
    extra.ANTHROPIC_BASE_URL = DEEPSEEK_BASE_URL;
    extra.ANTHROPIC_AUTH_TOKEN = spec.deepseekKey ?? '';
  }

  const env = userFacingEnv(extra);
  if (!spec.deepseekFlash) {
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }

  return env;
}

/**
 * The `kanban-pm` program's own name, and the CLI verb that starts it in an install with no
 * sources beside it.
 *
 * The pair is resolved HERE and not through the barrel's `getKanbanPmMcpCommand()`, which resolves
 * the identical command: the barrel re-exports the module this file belongs to, so importing it
 * back would be a cycle whose only purpose is to reach a function that names a file in this very
 * directory. `resolveMcpCommand` reads the DIRECTORY of its caller off the stack
 * (`mcp-command.ts:91-112`), and both call sites sit in `server/modules/kanban-metis/` — so the two
 * resolve the same command from the same place, and the barrel's copy keeps its own consumer in
 * `cli.service.ts`.
 */
const KANBAN_PM_MCP_SCRIPT = 'kanban-pm-mcp';
const KANBAN_PM_MCP_VERB = 'kanban-pm-mcp';

/**
 * The one MCP server this child can see, as the single JSON string `--mcp-config` takes.
 *
 * `--strict-mcp-config` rides beside it and is what makes this the ONLY one: no `descent-pm`, no
 * user-scope server, nothing the CLI would otherwise load from the operator's own configuration.
 * The four variables are the whole of what the stdio program reads, and its own environment is
 * where it reads them from — hence the `env` block rather than this process's environment.
 */
function buildMcpConfig(spec: MetisChildSpec): string {
  const { command, args } = resolveMcpCommand(KANBAN_PM_MCP_SCRIPT, KANBAN_PM_MCP_VERB);
  return JSON.stringify({
    mcpServers: {
      'kanban-pm': {
        command,
        args,
        env: {
          KANBAN_PM_API_URL: spec.apiOrigin,
          KANBAN_PM_TOKEN: metisBearer(spec.appSecret, spec.sessionId),
          KANBAN_PM_BOARD_ID: spec.boardId,
          KANBAN_PM_OWNER: deriveLeaseOwner(spec.sessionId),
        },
      },
    },
  });
}

/**
 * The child's argv, in the shape `~/.claude/hooks/plan_runner/souls.py:172-184` builds for a
 * launcher soul.
 *
 * `--permission-mode bypassPermissions` is what lets a detached session work unattended; the
 * hooks that matter still apply to her, and G5 in particular is what keeps her from asking the
 * operator a question through a chat prompt rather than the board.
 *
 * The conversation flag is ONE either/or and never two pushes. A first spawn mints the
 * conversation; a resume continues it. The value is the same uuid in both cases, and a child
 * handed both flags would be a child arguing with itself about which conversation it is in —
 * while a resume that minted instead would silently lose the card she was building.
 */
export function buildMetisArgv(spec: MetisChildSpec): string[] {
  const argv = [
    'claude',
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
  ];

  if (spec.resume) {
    argv.push('--resume', spec.sessionId);
  } else {
    argv.push('--session-id', spec.sessionId);
  }

  argv.push('--model', spec.model);
  argv.push('--append-system-prompt', spec.appendSystemPrompt);
  argv.push('--mcp-config', buildMcpConfig(spec));
  argv.push('--strict-mcp-config');

  // `--add-dir` is DERIVED from the board's project, not enumerated: a board that names no
  // project gets none at all and the child works only inside its own cwd.
  if (spec.addDir !== null) {
    argv.push('--add-dir', spec.addDir);
  }

  return argv;
}

/**
 * Writes one board's switch file, from the board row, at every spawn.
 *
 * Through the settings writer rather than a second one: its scratch-file-plus-rename is what
 * keeps a plan-runner reading this file mid-write from seeing an empty (OFF) flag. The host-wide
 * file is NEVER written from here — two boards on one host must be able to run different models,
 * and a switch the whole box shares cannot say that.
 */
export async function writeBoardFlag(boardId: string, enabled: boolean): Promise<void> {
  await writeFlagFile(boardFlagPath(boardId), enabled);
}
