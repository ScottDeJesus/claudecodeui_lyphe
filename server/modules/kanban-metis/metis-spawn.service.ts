import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { projectsDb } from '@/modules/database/index.js';
import { kanbanBoardsService } from '@/modules/kanban/index.js';
import type { KanbanBoard } from '@/shared/kanban-types.js';
import type { KanbanMetisSession } from '@/shared/types.js';
import { AppError, findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import {
  buildMetisArgv,
  buildMetisEnv,
  deriveLeaseOwner,
  metisOpeningTurn,
  metisRouteFor,
  writeBoardFlag,
  type MetisChildSpec,
} from './metis-env.service.js';
import type { MetisEndRecord, MetisRegistry, MetisSpecRecord } from './metis-registry.service.js';

/**
 * The machine that starts ONE Metis: mint her identity, write her record, hand her a detached
 * process with a log of her own, and keep the handle that can stop, resume or reply to her.
 *
 * There is no tick loop here and no SCHEDULING policy: WHEN a board is worth working on is the
 * driver's question and belongs to its own module; this one answers HOW, and it is deliberately the
 * only file in the module that starts a process at all, so that "what does a launch actually do" has
 * one answer. The one thing it does decide is the DIAL — how many sessions one board may run at
 * once — because that fence has to stand on every door that starts a child, and the door is here.
 *
 * Consumers: `kanban-metis.routes.ts` (launch, stop, resume, reply) and, in Phase 10, the driver's
 * tick — the same verbs, called on a schedule instead of by a click.
 */

/**
 * The CLI a Metis runs on, by name.
 *
 * Resolved from PATH rather than from an absolute path pinned here: this is the same `claude` the
 * operator runs by hand and the same one `~/.claude/hooks/plan_runner/souls.py` spawns
 * (`claude_bin()`), and an install that moved its CLI would otherwise leave every board launch
 * failing on a path only this file knew.
 */
const CLAUDE_BIN = 'claude';

/**
 * The child's working directory root — `~/.claude/kanban-metis/<boardId>/`.
 *
 * This path is not only a working directory. The seclusion predicate keys on exactly this root
 * (`claude-session-synchronizer.provider.ts:KANBAN_METIS_SESSION_ROOT`): a transcript whose `cwd`
 * is under it is a board session, and is never registered as one of the operator's own project
 * sessions. So a launch that put its child anywhere else would quietly pollute the session list
 * with a row per board build.
 */
const BOARD_CWD_ROOT = path.join(os.homedir(), '.claude', 'kanban-metis');

/**
 * How long a stopped Metis is given to end itself before it is killed outright.
 *
 * SIGTERM is the request; this is the deadline. Fifteen seconds is enough for the CLI to finish the
 * tool call it is in and write its result, and short enough that a Metis that ignores the signal
 * cannot sit there holding a lease the driver believes is free.
 */
const STOP_ESCALATE_MS = 15_000;

/** The brief's entry file and its chapters, in the order the child reads them. */
const BRIEF_FILE = 'METIS.md';
const BRIEF_CHAPTERS = [
  'autonomy-cadence',
  'learning',
  'mcp-fallback',
  'parallelism',
  'plan-template',
  'recovery',
] as const;

/** What the composition root hands the spawner: where, and with what. Nothing here reads the env. */
export type MetisSpawnDependencies = {
  registry: MetisRegistry;
  /** The running server's own origin, resolved once at composition. */
  apiOrigin: string;
  /** The app's JWT signing secret, from which each child's bearer and owner are derived. */
  appSecret: string;
  /** The DeepSeek key reader from `@/modules/deepseek/index.js`, called only for a Flash board. */
  readDeepseekKey: () => Promise<string | null>;
};

export type MetisSpawner = {
  /** Starts one Metis for a board and answers with her record. */
  launch(input: { boardId: string; launchedBy: 'operator' | 'driver' }): Promise<KanbanMetisSession>;
  /** SIGTERM, then SIGKILL after {@link STOP_ESCALATE_MS}. Idempotent on a session already ended. */
  stop(sessionId: string): KanbanMetisSession;
  /** Continues a session's conversation in place. Throws when she is already running. */
  resume(sessionId: string): Promise<KanbanMetisSession>;
  /**
   * Hands one person's words to a session that is NOT running, as the turn she wakes up to.
   *
   * The same `--resume <sessionId>` a resume sends, with `text` in place of the standard opening
   * turn — one conversation, continued deliberately. A session whose child is still running cannot
   * receive it (her stdin was closed at spawn and nothing in this repository can reach it), and a
   * board at its dial cannot gain a child through this door either: both refusals are 409s.
   */
  reply(sessionId: string, text: string): Promise<KanbanMetisSession>;
};

/**
 * May one more Metis be started on this board?
 *
 * Pure arithmetic over the two facts the caller gathers — how many of the board's sessions are
 * running NOW, and the board's own dial — in the shape `metis-liveness.ts` uses for its own
 * verdicts: no process, no file and no database is touched here, and the rule can be read without a
 * running server. That shape is why this predicate can be handed to `launch`, `resume` and `reply`
 * alike without any of them re-deriving a count of its own.
 *
 * `live < dial` and not `live <= dial`: with one session running against a dial of one there is no
 * room, and `dial` of zero is a real setting — a board dialled to zero spawns nothing at all.
 *
 * The reason is a whole sentence, and it NAMES THE DIAL AND ITS VALUE, because the two callers that
 * show a refusal to a person (the reply route and the launch route) put these words on the screen:
 * "at its dial of 1" is a fact the operator can act on; "cannot spawn" is not.
 */
export function canSpawn(input: { live: number; dial: number }): { allowed: boolean; reason: string | null } {
  if (input.live < input.dial) return { allowed: true, reason: null };

  if (input.dial === 0) {
    return { allowed: false, reason: 'this board is dialled to 0 — it spawns nothing' };
  }
  const running = input.live === 1 ? '1 session is running' : `${input.live} sessions are running`;
  return {
    allowed: false,
    reason: `this board is at its dial of ${input.dial} — ${running}, so there is no room for another`,
  };
}

/** Where the brief lives, resolved from the APPLICATION root so `dist-server` reads the same tree. */
function briefRoot(): string {
  return path.join(
    findApplicationRoot(getModuleDirectory(import.meta.url)),
    'server',
    'modules',
    'kanban-metis',
    'brief',
  );
}

/**
 * The brief as the one string the child is handed, with the path and hash that stand in for it
 * everywhere else.
 *
 * The chapters already carry their own `# Metis chapter — …` headings, so nothing is invented here:
 * they are concatenated in the order the plan names, under blank-line separation, and the brief's
 * own file comes first because it is the one that describes the board she is working.
 *
 * The hash is over the COMPOSED string — the bytes the child actually received — and not over one
 * of the seven files: what a later reader wants to know is whether the prompt that built a session
 * is the prompt on disk today, and a hash of the entry file alone would say nothing about a chapter
 * that had been rewritten under it.
 */
export function readMetisBrief(): { text: string; filePath: string; sha256: string } {
  const root = briefRoot();
  const filePath = path.join(root, BRIEF_FILE);
  const parts = [fs.readFileSync(filePath, 'utf8').trimEnd()];
  for (const chapter of BRIEF_CHAPTERS) {
    parts.push(fs.readFileSync(path.join(root, 'chapters', `${chapter}.md`), 'utf8').trimEnd());
  }
  const text = parts.join('\n\n');
  return { text, filePath, sha256: crypto.createHash('sha256').update(text).digest('hex') };
}

/**
 * The board's project as a real directory, or `null` when there is none to name.
 *
 * `project_id` is a foreign key, not a path: a board that has never been pointed at a checkout, or
 * whose project row was removed, gets NO `--add-dir` at all rather than the child's own cwd — the
 * difference being a Metis who can read the repository she is building and one who cannot.
 */
function resolveAddDir(projectId: string | null): string | null {
  return projectId === null ? null : projectsDb.getProjectPathById(projectId);
}

/**
 * How a child that has ended reads on the board, off the exit the OS handed the parent.
 *
 * A SIGNAL is `stopped`, not `failed`: the only signals that reach here are the ones this module
 * sent, and a Metis the operator stopped did not break.
 *
 * `askedToStop` is what makes the exit-CODE path honest, and it is not a refinement. MEASURED
 * 2026-09-16: a real `claude -p` child answers a SIGTERM by TRAPPING it and exiting 143 rather than
 * dying by the signal, so node reports `code=143, signal=null` — and a Metis the operator stopped
 * from the panel would be filed as a crash. Only this process knows it asked her to stop, so only
 * this process can say so. `143` alone is read the same way, for the terminations that come from
 * outside: the driver's own reaper in Phase 10, or the operator's shell. An OOM kill is 137 and
 * stays a failure, which is right — nothing asked that child to end and it did not choose to.
 */
function endForExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  askedToStop: boolean,
): MetisEndRecord {
  const endedAt = Date.now();
  if (signal !== null) {
    return { state: 'stopped', cause: `killed by ${signal}`, exitCode: code, endedAt };
  }
  if (askedToStop || code === 143) {
    return { state: 'stopped', cause: `stopped (exit ${code})`, exitCode: code, endedAt };
  }
  if (code === 0) {
    return { state: 'completed', cause: 'exit 0 (success)', exitCode: 0, endedAt };
  }
  return { state: 'failed', cause: `exit ${code}`, exitCode: code, endedAt };
}

/**
 * Builds the spawner over one registry.
 *
 * The registry is the only place a session is remembered, and the map below is only the handle
 * table: a `ChildProcess` this process forked, kept so `stop` can signal it and so its exit can be
 * caught. A session this process did NOT fork — one re-adopted after a restart — has no entry here
 * and is stopped by pid instead, which is why nothing below assumes the handle exists.
 */
export function createMetisSpawner(dependencies: MetisSpawnDependencies): MetisSpawner {
  const { registry, apiOrigin, appSecret, readDeepseekKey } = dependencies;
  const children = new Map<string, ChildProcess>();
  /**
   * Sessions this process has been asked to end. The `exit` handler reads it and clears it in the
   * same breath, because a session can be stopped once per spawn — a resumed one starts again with
   * no request outstanding against her.
   */
  const stopping = new Set<string>();

  /**
   * The SIGKILL a stop has in flight, by session id.
   *
   * A SESSION ID IS REUSED — that is what a resume is — so a timer that acted on the id alone
   * would, fifteen seconds after an ordinary stop, end whichever run happened to be under that id
   * by then. MEASURED 2026-09-16: stop at t=0, resume at t=+1s, and the stale timer marked the NEW
   * run `stopped`, wrote it a `result.json` reading `SIGKILL after 15s`, and left her own derived
   * credential answering 401 at `/api/kanban-pm` while the child was alive and building — an
   * orphan no second `stop` would signal, because the record it reads says she has already ended.
   *
   * Both of the things that make a pending escalation meaningless therefore CANCEL it: the child it
   * was armed for exiting (`clearEscalation` in both the `exit` and `error` handlers) and a new
   * spawn under the same id (`clearEscalation` as a spawn begins). What is left is bound to the run
   * it was armed for by pid — see `stop`.
   */
  const escalations = new Map<string, NodeJS.Timeout>();

  /** Disarms a pending escalation. Safe for a session that never had one. */
  const clearEscalation = (sessionId: string): void => {
    const timer = escalations.get(sessionId);
    if (timer === undefined) return;
    clearTimeout(timer);
    escalations.delete(sessionId);
  };

  /**
   * One child, detached, with the log file as its OWN stdout and stderr.
   *
   * THE FILE DESCRIPTOR IS THE CONTRACT. A piped stdout would be a pipe the server owns, and this
   * child outlives the server: the moment this process restarts, the read end is gone and the child
   * blocks on a full 64 KB pipe buffer or dies on `EPIPE` — and either way `child.log`'s mtime is
   * frozen from then on, which the driver's quiescence rule reads as a quiet Metis and reaps
   * mid-build. Handing the open file over and closing the PARENT's handle leaves the child writing
   * to a file nothing else in this system has a reason to touch.
   */
  const spawnChild = async (
    spec: MetisChildSpec,
    specRecord: MetisSpecRecord,
    cwd: string,
  ): Promise<void> => {
    // A spawn ALWAYS cancels a stop's pending escalation: whoever this session id belonged to a
    // moment ago, this child is not them, and a timer left armed would end her instead.
    clearEscalation(spec.sessionId);

    const argv = buildMetisArgv(spec);
    // `argv[0]` is the program and the rest are its arguments — the shape `souls.py` builds and
    // hands to `Popen` as one list, where the first element is likewise the binary.
    const [bin = CLAUDE_BIN, ...args] = argv;
    const logPath = path.join(registry.sessionDir(spec.sessionId), 'child.log');
    const log = await fsp.open(logPath, 'a');

    try {
      const child = spawn(bin, args, {
        detached: true,
        // The child's stdin is the one pipe: the single opening turn is written and then closed.
        stdio: ['pipe', log.fd, log.fd],
        cwd,
        env: buildMetisEnv(spec),
      });

      if (child.stdin === null) {
        // Cannot happen with a `'pipe'` stdio entry, and if it ever did, a child with no turn would
        // sit waiting for input it will never get. Killed rather than left running.
        child.kill('SIGKILL');
        throw new AppError('the spawned Metis has no stdin pipe to hand its turn to.', {
          statusCode: 500,
          code: 'METIS_SPAWN_FAILED',
        });
      }
      // The turn, then EOF: `claude -p` with unwritten stdin waits for input forever
      // (`souls.py:310-312` writes the prompt and closes for exactly this reason).
      child.stdin.write(specRecord.openingTurn);
      child.stdin.end();

      child.on('exit', (code, signal) => {
        children.delete(spec.sessionId);
        // This child has answered for the stop; whatever timer was waiting to escalate on her has
        // nothing left to do, and firing it later would only reach a run that is not hers.
        clearEscalation(spec.sessionId);
        registry.finish(spec.sessionId, endForExit(code, signal, stopping.delete(spec.sessionId)));
      });
      // A spawn that failed outright reports it here rather than by never exiting — `ENOENT` for a
      // CLI that is not on PATH, which would otherwise be a session painted `running` for ever.
      child.on('error', (error) => {
        children.delete(spec.sessionId);
        clearEscalation(spec.sessionId);
        registry.finish(spec.sessionId, {
          state: 'failed',
          cause: `spawn failed: ${error.message}`,
          exitCode: null,
          endedAt: Date.now(),
        });
      });

      if (child.pid !== undefined) {
        registry.notePid(spec.sessionId, child.pid);
        children.set(spec.sessionId, child);
      }
      // The parent lets go of the child on purpose: a Metis is not this process's to wait for, and
      // a referenced child would keep a shutting-down server alive until she finished.
      child.unref();
    } finally {
      // The parent's handle only. The child holds its own copy of the descriptor and keeps writing.
      await log.close();
    }
  };

  /** Everything one spawn or resume needs, gathered in one place so the two cannot drift. */
  const prepare = async (input: {
    boardId: string;
    sessionId: string;
    launchedBy: 'operator' | 'driver';
    resumed: boolean;
    /**
     * The turn this child is asked to take. Absent means the standard one (`metisOpeningTurn`); a
     * REPLY passes a person's own words here, which is the only difference between the two.
     */
    openingTurn?: string;
  }): Promise<{ spec: MetisChildSpec; record: MetisSpecRecord; cwd: string }> => {
    const board = kanbanBoardsService.getBoard(input.boardId);
    if (board === null) {
      throw new AppError(`No board with id "${input.boardId}".`, {
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    }

    // THE DIAL, ASKED AT THE ONE PLACE EVERY SPAWNER PATH PASSES THROUGH — launch, resume and reply
    // all call `prepare` before they create anything, so no door starts a child without this gate
    // and a fourth door added later cannot forget it. The two facts are gathered HERE rather than
    // remembered: the board row was read a line above, and the live count is counted at this
    // instant, so a dial moved from the panel is honoured by the next spawn instead of by the next
    // restart.
    ensureDialAllows(board);
    const route = metisRouteFor(board.deepseekFlash);
    // A Flash board with no key is refused HERE, before this launch has created anything: the
    // alternative is a 201 `running` and a child that dies on its first model call, which reads to
    // the operator as a broken board rather than an unset key. Read only for a Flash board — a
    // Claude child has no use for the key, and a reader that ran for every launch would open the
    // operator's `.env` for a reason no Metis on Claude could name.
    const deepseekKey = board.deepseekFlash ? await readDeepseekKey() : null;
    if (board.deepseekFlash && (deepseekKey === null || deepseekKey.trim() === '')) {
      throw new AppError(
        `Board "${board.id}" runs on DeepSeek Flash, but no DeepSeek API key is configured.`,
        { statusCode: 503, code: 'DEEPSEEK_KEY_MISSING' },
      );
    }

    const startedAt = Date.now();
    const brief = readMetisBrief();
    const cwd = path.join(BOARD_CWD_ROOT, board.id);
    fs.mkdirSync(cwd, { recursive: true });
    // Written at every spawn, from the board's own row: the child's plan-runners read this file
    // per call (`deepseek.py:flag_path`), so it is what makes the board's switch the thing they
    // obey rather than the host-wide file the operator's own sessions use.
    await writeBoardFlag(board.id, board.deepseekFlash);

    const spec: MetisChildSpec = {
      boardId: board.id,
      sessionId: input.sessionId,
      model: route.model,
      provider: route.provider,
      deepseekFlash: board.deepseekFlash,
      apiOrigin,
      appSecret,
      deepseekKey,
      appendSystemPrompt: brief.text,
      addDir: resolveAddDir(board.projectId),
      resume: input.resumed,
    };

    const record: MetisSpecRecord = {
      sessionId: input.sessionId,
      boardId: board.id,
      boardName: board.name,
      provider: route.provider,
      model: route.model,
      owner: deriveLeaseOwner(input.sessionId),
      launchedBy: input.launchedBy,
      apiOrigin,
      cwd,
      openingTurn: input.openingTurn ?? metisOpeningTurn(board.id),
      briefPath: brief.filePath,
      briefSha256: brief.sha256,
      resumed: input.resumed,
      startedAt,
    };

    return { spec, record, cwd };
  };

  /**
   * How many of a board's Metises are running right now — one of the two facts `canSpawn` reads.
   *
   * Counted from the registry at the instant it is asked, never remembered: a session that has just
   * exited may still read `running` here, and that is the safe direction — the board fills one tick
   * later rather than overshooting.
   */
  const liveCountForBoard = (boardId: string): number =>
    registry.list().filter((session) => session.boardId === boardId && session.state === 'running').length;

  /**
   * The dial's gate: the board's number against its live count, refused in `canSpawn`'s own words.
   *
   * A 409, because nothing here is malformed — the request is a perfectly good one that the board
   * is not in a state to accept, and the operator's fix is to stop a session or raise the dial.
   */
  const ensureDialAllows = (board: KanbanBoard): void => {
    const verdict = canSpawn({ live: liveCountForBoard(board.id), dial: board.concurrency });
    if (verdict.allowed) return;
    // The fallback is unreachable — `canSpawn` names the dial whenever it refuses — and it is here
    // so that a refusal can never be rendered as an empty message.
    throw new AppError(verdict.reason ?? `Board "${board.id}" has no room for another session.`, {
      statusCode: 409,
      code: 'CONFLICT',
    });
  };

  /**
   * One person's words to a session whose child has stopped, as the turn she wakes up to.
   *
   * This is `resume` with the TEXT in place of the standard opening turn, and everything else is
   * deliberately the same: the same `--resume <sessionId>` continues the same conversation, the
   * brief is re-read from disk and handed over again, and the `--mcp-config` / `--strict-mcp-config`
   * pair, the permission mode and the environment are the ones every spawn builds. Her own record
   * carries the reply verbatim as its `openingTurn`, so `spec.json` answers "what was she actually
   * asked" for this turn the way it does for the first one.
   *
   * Its two refusals, in the order they are asked:
   *
   * 1. SHE IS RUNNING. Her stdin was closed when she was spawned (`child.stdin.end()`), and there is
   *    no live-injection path in this repository — the chat websocket and the session host know
   *    nothing of her. A turn held back until she finished would be a queued turn nobody can see,
   *    which is worse than a refusal the screen can explain, so this one is a 409 saying exactly
   *    what to do about it.
   * 2. THE BOARD IS AT ITS DIAL. `prepare` asks `canSpawn` on the way through, so a reply cannot
   *    slip a child onto a board that is already full — the same gate, the same words, whatever the
   *    door it came in through.
   */
  const reply = async (sessionId: string, text: string): Promise<KanbanMetisSession> => {
    const previous = registry.specOf(sessionId);
    const session = registry.get(sessionId);
    if (previous === null || session === null) {
      throw new AppError(`No Metis session with id "${sessionId}".`, {
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    }
    if (session.state === 'running') {
      throw new AppError('she is mid-turn — stop her first, then reply', {
        statusCode: 409,
        code: 'CONFLICT',
      });
    }

    const { spec, record, cwd } = await prepare({
      boardId: previous.boardId,
      sessionId,
      launchedBy: 'operator',
      resumed: true,
      openingTurn: text,
    });
    registry.record(record);
    await spawnChild(spec, record, cwd);
    return registry.get(sessionId) ?? session;
  };

  return {
    launch: async (input) => {
      // AN OPERATOR LAUNCH IS REFUSED WHILE THE BOARD IS ALREADY AT ITS DIAL, and so is a driver
      // launch — `prepare` asks the same question of both, because there is one number and both
      // paths spend it. Two children of one board share a cwd
      // (`~/.claude/kanban-metis/<boardId>/`) and are handed DIFFERENT lease owners, so they claim
      // cards against each other while neither click stops the other; the shared directory is the
      // ORDINARY case up to the dial, and it is safe there because nothing per-session is written
      // into it — every per-session file lives under
      // `~/.claude/state/kanban-metis/<sessionId>/` — and because the arbiter of who owns a card is
      // the lease CAS, not the directory. A per-session cwd is FORBIDDEN: `~/.claude/hooks/
      // kanban_metis.py`'s `board_id()` reads the leaf directly under the session root, so a deeper
      // path would make every board session invisible to the seclusion predicate.
      const sessionId = crypto.randomUUID();
      const { spec, record, cwd } = await prepare({ ...input, sessionId, resumed: false });
      // BEFORE the spawn. The record is what a server that restarts mid-launch re-adopts from, and
      // a child with no `spec.json` is a directory nothing can say anything honest about — so the
      // ordering here is what makes a crash between these two lines a recoverable session rather
      // than an orphan.
      registry.record(record);
      await spawnChild(spec, record, cwd);
      const session = registry.get(sessionId);
      if (session === null) {
        throw new AppError('the spawned Metis was not recorded.', {
          statusCode: 500,
          code: 'METIS_SPAWN_FAILED',
        });
      }
      return session;
    },

    stop: (sessionId) => {
      const session = registry.get(sessionId);
      if (session === null) {
        throw new AppError(`No Metis session with id "${sessionId}".`, {
          statusCode: 404,
          code: 'NOT_FOUND',
        });
      }
      // Idempotent: stopping a session that has already ended is the state the caller asked for, so
      // it answers with the record rather than an error — a retried request is not a mistake.
      if (session.state !== 'running') return session;

      const pid = session.pid;
      if (pid === null) {
        // Running with no pid means the child is already gone and nothing wrote its ending.
        registry.finish(sessionId, {
          state: 'stopped',
          cause: 'stopped before a pid was recorded',
          exitCode: null,
          endedAt: Date.now(),
        });
        return registry.get(sessionId) ?? session;
      }

      // Recorded BEFORE the signal, so the exit it causes cannot arrive first and be read as a
      // crash. A child this process did not fork has no exit handler to consult this, and the
      // escalation below writes her ending directly instead.
      stopping.add(sessionId);
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already gone between the read and the signal. The ending below is still the honest one.
        stopping.delete(sessionId);
        registry.finish(sessionId, {
          state: 'stopped',
          cause: 'already gone when stopped',
          exitCode: null,
          endedAt: Date.now(),
        });
        return registry.get(sessionId) ?? session;
      }

      const escalate = setTimeout(() => {
        escalations.delete(sessionId);
        // THE RUN THIS TIMER WAS ARMED FOR IS THE ONLY ONE IT MAY END, and the pid is what tells
        // the runs apart. A resume mints a new child under the same id, so a signal aimed at the id
        // would reach a stranger — and `finish` would mark a session that is still building as
        // stopped, revoking the credential of a child that never stopped.
        const current = registry.get(sessionId);
        if (current === null || current.state !== 'running' || current.pid !== pid) return;

        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Exited on the SIGTERM, which is the answer this timer was waiting for.
        }
        stopping.delete(sessionId);
        // A Metis this process did NOT fork has no exit handler to notice her death, so the ending
        // is written here; for one it did, the exit handler won the race and this is a no-op.
        registry.finish(sessionId, {
          state: 'stopped',
          cause: `SIGKILL after ${STOP_ESCALATE_MS / 1000}s`,
          exitCode: null,
          endedAt: Date.now(),
        });
      }, STOP_ESCALATE_MS);
      escalations.set(sessionId, escalate);
      // Unreferenced so a pending escalation never keeps a shutting-down server alive.
      escalate.unref();

      return registry.get(sessionId) ?? session;
    },

    resume: async (sessionId) => {
      const previous = registry.specOf(sessionId);
      const session = registry.get(sessionId);
      if (previous === null || session === null) {
        throw new AppError(`No Metis session with id "${sessionId}".`, {
          statusCode: 404,
          code: 'NOT_FOUND',
        });
      }
      if (session.state === 'running') {
        // Two children in one conversation would both claim cards and both rewrite the same file.
        throw new AppError(`Metis session "${sessionId}" is already running.`, {
          statusCode: 409,
          code: 'CONFLICT',
        });
      }

      const { spec, record, cwd } = await prepare({
        boardId: previous.boardId,
        sessionId,
        // A resume is never the driver's act: it is asked for, and the record says so.
        launchedBy: 'operator',
        resumed: true,
      });
      // The board's switch and the brief on disk are re-read by `prepare`, so a resume runs the
      // board as it stands NOW — that is the whole reason a session is resumed rather than
      // re-launched. What does not change is the conversation: the same session id, and the same
      // opening turn, which is a function of the board id and so is re-sent word for word.
      registry.record(record);
      await spawnChild(spec, record, cwd);
      return registry.get(sessionId) ?? session;
    },

    reply,
  };
}
