import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { KanbanMetisSession } from '@/shared/types.js';
import { expandHome } from '@/shared/utils.js';

/**
 * The live-session registry: which board Metis sessions exist, what each one is doing, and the
 * disk home that outlives this process.
 *
 * Every fact here is either in memory or in one small file under
 * `~/.claude/state/kanban-metis/<sessionId>/`, in the layout
 * `~/.claude/state/dispatch-souls/<launch id>/` uses — `spec.json` at the start, `result.json` at
 * the end, `child.pid` while it runs and `child.log`, which the child itself owns. The layout is
 * copied rather than invented for one reason: the launcher's own liveness read works, and this is
 * the same question asked of a different kind of child.
 *
 * NO CREDENTIAL IS EVER HELD HERE. The registry answers `isRunning` — the running set the
 * `kanban-pm` guard consults — and nothing else about a session's authority; the child's secret is
 * recomputed from the app's signing secret on every request
 * (`metis-env.service.ts:deriveMetisSecret`), so a restart empties this map without locking out a
 * single live child.
 */

/** The state root, written the way an operator would. `expandHome` is what makes it a real path. */
export const DEFAULT_METIS_STATE_ROOT = '~/.claude/state/kanban-metis';

/**
 * The start record, written to `spec.json` BEFORE the child exists.
 *
 * It carries the opening turn VERBATIM and the brief's PATH and sha256 — never the brief's text.
 * The brief is nine hundred lines of prose that is already on disk in the source tree, and copying
 * it into every session's directory would grow the operator's state root by a novel per launch
 * while giving a reader nothing the path plus the hash does not already give them: the path names
 * the file, and the hash says whether the file a reader finds today is the one she was handed.
 */
export type MetisSpecRecord = {
  /** The sessionId this record names, taken from the verified token or from a board. */
  sessionId: string;
  boardId: string;
  boardName: string;
  provider: 'deepseek' | 'claude';
  model: string;
  owner: string;
  launchedBy: 'operator' | 'driver';
  /** The origin the child's MCP client writes through — the SERVER THAT SPAWNED HER, not a default. */
  apiOrigin: string;
  /** The child's working directory, `~/.claude/kanban-metis/<boardId>/` resolved to a real path. */
  cwd: string;
  /** The one turn handed on stdin, verbatim, so a reader months later knows what she was asked. */
  openingTurn: string;
  briefPath: string;
  briefSha256: string;
  /**
   * `false` for a first spawn (`--session-id` mints the conversation) and `true` for a resume
   * (`--resume` continues it). Recorded because the two are indistinguishable afterwards — the
   * directory is keyed by the session id in both cases — and "was this session restarted" is the
   * first question a reader asks of a log with two openings in it.
   */
  resumed: boolean;
  /** Epoch MILLISECONDS, unlike the launcher's Python seconds — this file is written here. */
  startedAt: number;
};

/** How a session ended, as the exit handler and the re-adoption pass both write it. */
export type MetisEndRecord = {
  state: 'completed' | 'stopped' | 'failed';
  /** One plain sentence for the reader, e.g. `exit 0 (success)` or `SIGKILL after 15s`. */
  cause: string;
  exitCode: number | null;
  endedAt: number;
};

export type MetisRegistry = {
  /** The session as of NOW — `lastActivityAt` is re-read from the log rather than remembered. */
  get(sessionId: string): KanbanMetisSession | null;
  /** Every session, oldest first. The lane's whole picture. */
  list(): KanbanMetisSession[];
  /** Is this session alive right now? The one question the `kanban-pm` guard asks. */
  isRunning(sessionId: string): boolean;
  /** Where a session's files live, so a caller can name `child.log` without re-deriving the layout. */
  sessionDir(sessionId: string): string;
  /**
   * The start record, for the one caller that has to REPEAT a session rather than start one: a
   * resume re-sends the same opening turn into the same conversation, and this is where the
   * spawned words are kept. Never `null` for a session `get` knows — a re-adopted one is rebuilt
   * from its own `spec.json`.
   */
  specOf(sessionId: string): MetisSpecRecord | null;
  /** Writes `spec.json` and opens the record. Called BEFORE the spawn, never after. */
  record(spec: MetisSpecRecord): KanbanMetisSession;
  /** Writes `child.pid`, once the spawn has answered with one. */
  notePid(sessionId: string, pid: number): void;
  /** Writes `result.json` and closes the record. Idempotent: the first ending written wins. */
  finish(sessionId: string, end: MetisEndRecord): void;
};

/** One session's memory: the record the frame paints, plus the spec a resume has to re-send. */
type Entry = {
  session: KanbanMetisSession;
  spec: MetisSpecRecord;
};

/** One of the four files, or `null` for a session whose directory or file is not there. */
function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    // A directory from a launch that died mid-write, or a file being replaced right now: absent is
    // the honest answer, and every caller below already knows what to do with one.
    return null;
  }
}

/** A record's number, or the fallback. `typeof` alone admits `NaN`, which renders all the way out. */
function readNumber(record: Record<string, unknown>, name: string, fallback: number): number {
  const value = record[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A record's string, or `fallback` — free text landing in a frame that the client paints. */
function readString(record: Record<string, unknown>, name: string, fallback = ''): string {
  const value = record[name];
  return typeof value === 'string' ? value : fallback;
}

/**
 * Is this pid still the child it claims to be?
 *
 * TWO TESTS, and the second is not decoration. `process.kill(pid, 0)` answers whether SOME process
 * holds that number — and pids are recycled, so on a busy host the pid a session recorded an hour
 * ago is routinely a fresh shell or a build by the time the server comes back. A registration that
 * trusted the signal alone would paint a stranger as a live Metis, hand her a `running` state that
 * the guard's `isRunning` then honours, and keep doing it until that stranger exited. The child's
 * own argv names the session id it was given (`--session-id <uuid>`), so `/proc/<pid>/cmdline`
 * saying the same thing is the only evidence that this IS that Metis and not merely a live number.
 */
function ownsSession(pidPath: string, sessionId: string): number | null {
  try {
    const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);
    if (!fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(sessionId)) return null;
    return pid;
  } catch {
    // `ESRCH` (gone), `EPERM` (not ours) or an unreadable pid file all answer the same question the
    // same way: this session is not live, and nothing here is going to argue about which one it was.
    return null;
  }
}

/**
 * Builds the registry and RE-ADOPTS every session already on disk.
 *
 * The re-adoption pass is what keeps a restart from orphaning a board's work. A Metis is detached
 * and outlives this server, so at construction there are sessions whose children are still
 * thinking, whose `spec.json` is on disk and whose `result.json` will never be written by the
 * process that spawned them — the exit handler died with the old server. Each one is found by
 * name, judged by {@link ownsSession}, and either adopted as `running` or recorded as `failed`
 * with its `result.json` written then, so the ending is written ONCE by whoever notices it first.
 *
 * Re-adoption is bounded on purpose: it marks a child that is already gone, and stops there. Which
 * live sessions are quiescent, which have stalled and which should be reaped is the driver's
 * judgment and belongs to its tick, not to a constructor that runs before any socket is open.
 */
export function createMetisRegistry(root: string = DEFAULT_METIS_STATE_ROOT): MetisRegistry {
  const stateRoot = expandHome(root);
  const entries = new Map<string, Entry>();

  const dirFor = (sessionId: string): string => path.join(stateRoot, sessionId);
  const logPathFor = (sessionId: string): string => path.join(dirFor(sessionId), 'child.log');

  /**
   * When the child last wrote anything, as its log's mtime — the quiescence rule's whole input, and
   * therefore re-read rather than remembered: a cached copy would make a chatty child look idle
   * from the moment the lane first saw her.
   */
  const lastActivityFor = (sessionId: string, fallback: number): number => {
    try {
      return fs.statSync(logPathFor(sessionId)).mtimeMs;
    } catch {
      return fallback;
    }
  };

  const finish = (sessionId: string, end: MetisEndRecord): void => {
    const entry = entries.get(sessionId);
    if (entry === undefined) return;
    // The FIRST ending wins. Both the exit handler and a re-adoption pass can notice the same
    // child, and a second write would overwrite a real exit code with a stranger's guess.
    if (entry.session.endedAt !== null) return;

    const dir = dirFor(sessionId);
    const result = {
      session_id: sessionId,
      board_id: entry.session.boardId,
      status: end.state,
      cause: end.cause,
      exit_code: end.exitCode,
      log: logPathFor(sessionId),
      ended_at: end.endedAt,
    };
    try {
      fs.writeFileSync(path.join(dir, 'result.json'), `${JSON.stringify(result, null, 1)}\n`);
    } catch (error) {
      // The picture in memory is still right and the frame still says `stopped`; what is lost is the
      // file a later server would re-adopt from. Said, not swallowed, because the next restart is
      // when the loss is paid.
      console.error(
        `[KanbanMetis] could not write result.json for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    entry.session.state = end.state;
    entry.session.endedAt = end.endedAt;
    entry.session.exitCode = end.exitCode;
    entry.session.pid = null;
  };

  /**
   * One directory's record, or `null` when it is not a session this registry can speak about.
   *
   * A directory with no `spec.json` is a partial write from a launch that died between `mkdir` and
   * the record, and there is nothing honest to say about it — so it is dropped rather than painted.
   */
  const adoptDirectory = (sessionId: string): void => {
    const spec = readJson(path.join(dirFor(sessionId), 'spec.json'));
    if (spec === null) return;

    const startedAt = readNumber(spec, 'started_at', Date.now());
    const session: KanbanMetisSession = {
      sessionId,
      boardId: readString(spec, 'board_id'),
      boardName: readString(spec, 'board_name'),
      provider: readString(spec, 'provider') === 'deepseek' ? 'deepseek' : 'claude',
      model: readString(spec, 'model'),
      owner: readString(spec, 'owner'),
      launchedBy: readString(spec, 'launched_by') === 'driver' ? 'driver' : 'operator',
      state: 'running',
      pid: null,
      startedAt,
      endedAt: null,
      lastActivityAt: lastActivityFor(sessionId, startedAt),
      exitCode: null,
    };

    entries.set(sessionId, {
      session,
      spec: {
        sessionId,
        boardId: session.boardId,
        boardName: session.boardName,
        provider: session.provider,
        model: session.model,
        owner: session.owner,
        launchedBy: session.launchedBy,
        apiOrigin: readString(spec, 'api_origin'),
        cwd: readString(spec, 'cwd'),
        openingTurn: readString(spec, 'opening_turn'),
        briefPath: readString(spec, 'brief_path'),
        briefSha256: readString(spec, 'brief_sha256'),
        resumed: spec.resumed === true,
        startedAt,
      },
    });

    const result = readJson(path.join(dirFor(sessionId), 'result.json'));
    if (result !== null) {
      // It ended while no server was watching, and whatever wrote that receipt said how. The
      // receipt is the authority on the ending, so it is read back rather than re-derived — a
      // `stopped` session that this server re-judged would come back as a crash it never was.
      const status = readString(result, 'status');
      session.state = status === 'completed' ? 'completed' : status === 'stopped' ? 'stopped' : 'failed';
      session.endedAt = readNumber(result, 'ended_at', startedAt);
      const code = result.exit_code;
      session.exitCode = typeof code === 'number' && Number.isFinite(code) ? code : null;
      return;
    }

    const pid = ownsSession(path.join(dirFor(sessionId), 'child.pid'), sessionId);
    if (pid !== null) {
      session.pid = pid;
      return;
    }

    finish(sessionId, {
      state: 'failed',
      cause: 'child gone when the server restarted',
      exitCode: null,
      endedAt: Date.now(),
    });
  };

  try {
    for (const name of fs.readdirSync(stateRoot)) {
      if (!fs.statSync(path.join(stateRoot, name)).isDirectory()) continue;
      adoptDirectory(name);
    }
  } catch {
    // No state root yet — the ordinary case on a host that has never launched a Metis. Nothing to
    // adopt, and the first `record` creates the tree.
  }

  /**
   * The picture the lane paints, oldest first, with every `lastActivityAt` read off disk as it is
   * taken. Oldest first is the order the panel reads in, and `startedAt` holds it steady between
   * ticks — a picture that reshuffled would broadcast a change that is not one.
   */
  const snapshot = (): KanbanMetisSession[] =>
    [...entries.values()]
      .sort((left, right) => left.session.startedAt - right.session.startedAt)
      .map((entry) => ({
        ...entry.session,
        lastActivityAt: lastActivityFor(entry.session.sessionId, entry.session.startedAt),
      }));

  return {
    get: (sessionId) => snapshot().find((session) => session.sessionId === sessionId) ?? null,

    list: snapshot,

    isRunning: (sessionId) => entries.get(sessionId)?.session.state === 'running',

    sessionDir: (sessionId) => dirFor(sessionId),

    specOf: (sessionId) => entries.get(sessionId)?.spec ?? null,

    record: (spec) => {
      const dir = dirFor(spec.sessionId);
      fs.mkdirSync(dir, { recursive: true });
      // A RESUME lands in the same directory as the spawn it continues, so the ending the first run
      // wrote has to go: a server that restarted now would read that stale receipt as this run's
      // and report a session that is mid-build as finished. Force-removed rather than checked, so
      // there is no window in which an old receipt is still there to be read.
      fs.rmSync(path.join(dir, 'result.json'), { force: true });
      // snake_case, deliberately: this file sits beside `dispatch-souls`' own `spec.json`, which
      // the launcher's Python writes, and two neighbouring launch records disagreeing about their
      // field names is a reader checking one of them against the other and finding nothing.
      const disk = {
        session_id: spec.sessionId,
        board_id: spec.boardId,
        board_name: spec.boardName,
        provider: spec.provider,
        model: spec.model,
        owner: spec.owner,
        launched_by: spec.launchedBy,
        api_origin: spec.apiOrigin,
        cwd: spec.cwd,
        opening_turn: spec.openingTurn,
        brief_path: spec.briefPath,
        brief_sha256: spec.briefSha256,
        resumed: spec.resumed,
        started_at: spec.startedAt,
      };
      fs.writeFileSync(path.join(dir, 'spec.json'), `${JSON.stringify(disk, null, 1)}\n`);

      const session: KanbanMetisSession = {
        sessionId: spec.sessionId,
        boardId: spec.boardId,
        boardName: spec.boardName,
        provider: spec.provider,
        model: spec.model,
        owner: spec.owner,
        launchedBy: spec.launchedBy,
        state: 'running',
        pid: null,
        startedAt: spec.startedAt,
        endedAt: null,
        lastActivityAt: spec.startedAt,
        exitCode: null,
      };
      entries.set(spec.sessionId, { session, spec });
      return { ...session };
    },

    notePid: (sessionId, pid) => {
      const entry = entries.get(sessionId);
      if (entry === undefined) return;
      try {
        fs.writeFileSync(path.join(dirFor(sessionId), 'child.pid'), String(pid));
      } catch (error) {
        console.error(
          `[KanbanMetis] could not write child.pid for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      entry.session.pid = pid;
    },

    finish,
  };
}

/**
 * The one registry this process built, for the two callers that cannot be handed it.
 *
 * `server/index.ts` mounts the `kanban-pm` guard as a bare middleware, exactly as the plan's two
 * mount lines read, so the guard has no argument to receive a registry through — and a guard that
 * built one of its own would be a second map, empty of every session the spawner ever recorded,
 * refusing every child. The composition root sets this once, before any request can arrive.
 */
let live: MetisRegistry | null = null;

/** Called by `kanban-metis.module.ts` as it composes. The driver reads it back in Phase 10. */
export function setLiveMetisRegistry(registry: MetisRegistry): void {
  live = registry;
}

/** The process's registry, or `null` before the module is composed — which a caller must deny on. */
export function getLiveMetisRegistry(): MetisRegistry | null {
  return live;
}
