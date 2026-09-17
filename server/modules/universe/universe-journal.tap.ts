import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

import type { UniverseActivityInput, UniverseRegistryEntry } from '@/shared/types.js';

import type { UniverseMapService } from './universe-map.service.js';
import { matchPath } from './universe-route-match.js';

/**
 * Tap 1: the estate's journal, followed live.
 *
 * One `journalctl -f -o json` child per module start, for every unit the registry names, with
 * `-n 0` so only lines written from now on arrive — a tap that replayed history would flood the
 * canvas with months of access logs on the tab's first paint. Nothing here writes anything: it
 * reads a stream that already exists, resolves each line to a star on the map, and hands the row
 * to the coalescer.
 */

/**
 * One journal line's own words, as far as they identify anything.
 *
 * `method`/`path` come off an HTTP access line, `logger` off a Python logger line, and neither
 * means the line said nothing about itself — which is the common case and not a failure.
 */
export type JournalMessage = { method?: string; path?: string; logger?: string };

/**
 * An access line in either of the two shapes this estate writes: uvicorn's
 * `INFO: 127.0.0.1:57360 - "POST /api/… HTTP/1.1" 200 OK` and descent's
 * `[descent] 127.0.0.1 "GET /api/memory?status=pending HTTP/1.1" 200 -`.
 *
 * One pattern for both because the quoted request is what they share: whatever precedes the quote
 * is the logger's business and differs between frameworks, and whatever follows it is a status.
 */
const ACCESS_LINE = /"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+) HTTP\/[\d.]+"/;

/**
 * A Python logger line: `<date> <time>,<ms> <dotted.logger.name> <LEVEL> <message>`. Only the four
 * standard levels count — a line whose third word is not one of them is prose, not a logger.
 */
const LOGGER_LINE = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d[,.]\d+ ([A-Za-z_][\w.]*) (?:DEBUG|INFO|WARNING|ERROR|CRITICAL)\b/;

/**
 * Consumed by the journal tap's own line handler, and by the phase's checks as a probe: it is the
 * whole of what "read a journal line" means, with no map, no child and no clock in it.
 */
export function parseJournalMessage(message: string): JournalMessage {
  const access = ACCESS_LINE.exec(message);
  if (access !== null) {
    const target = access[2];
    const query = target.indexOf('?');
    // The query is dropped here and not later: `?status=pending` is not part of a route, and the
    // matcher needs the path the route table was dumped with.
    return { method: access[1], path: query === -1 ? target : target.slice(0, query) };
  }
  const logger = LOGGER_LINE.exec(message);
  if (logger !== null) return { logger: logger[1] };
  return {};
}

/** A unit the journal child follows, and what a line from it falls back to. */
type UnitSubject = { repoId: string; entryFile: string };

export type JournalTapDependencies = {
  /** The registry's entries. Read at `start()`, so a child is spawned from what the file says then. */
  registry: () => UniverseRegistryEntry[];
  /** The held map, through the service: routes and loggers for resolution, and node indices. */
  map: UniverseMapService;
  /** Where a resolved line goes. Called once per accepted journal line. */
  push: (row: UniverseActivityInput) => void;
  /** The server has no logger; a module that must say something takes a closure. */
  logError: (message: string) => void;
};

export type JournalTap = { start(): void; stop(): void };

/**
 * How long to wait before respawning a dead child, in order; the last value repeats for every later
 * attempt. A rotation briefly closes the journal, a permission problem does not — so the ladder
 * starts at a second (nothing is missed) and settles at thirty (nothing spins).
 */
const RESPAWN_DELAYS_MS = [1000, 5000, 30000];

/** One `journalctl` JSON record, as far as this tap reads it. */
function parseJournalRecord(line: string): { unit: string; message: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // A line journalctl could not hand over whole is not this tap's problem to report: the next
    // line is a second away and the journal is the authority on its own output.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as { MESSAGE?: unknown; _SYSTEMD_UNIT?: unknown };
  if (typeof record._SYSTEMD_UNIT !== 'string' || typeof record.MESSAGE !== 'string') return null;
  return { unit: record._SYSTEMD_UNIT, message: record.MESSAGE };
}

/** Every followed unit and the repo it belongs to. A unit named by two repos keeps the first. */
function buildSubjects(entries: UniverseRegistryEntry[]): Map<string, UnitSubject> {
  const subjects = new Map<string, UnitSubject>();
  const add = (unit: string, subject: UnitSubject): void => {
    if (unit !== '' && !subjects.has(unit)) subjects.set(unit, subject);
  };
  for (const entry of entries) {
    const subject = { repoId: entry.id, entryFile: entry.entry_file };
    for (const unit of entry.units) add(unit, subject);
    // An app's own unit: `eis-app.service` serves an app that LIVES in shadow-connector, so the
    // unit's lines pulse that repo's stars even though the unit is named for another repo.
    for (const app of entry.apps) add(app.unit, subject);
  }
  return subjects;
}

export function createJournalTap(dependencies: JournalTapDependencies): JournalTap {
  let subjects = new Map<string, UnitSubject>();

  /**
   * The star an access line pulses: the route it matched, among the routes of THIS unit's repo.
   *
   * The repo filter is what stops `GET /health`, which two repos both serve, from pulsing whichever
   * one the crawler happened to write first. A route declared in another repo is not a candidate for
   * this unit at all — the same request on another unit matches there.
   */
  const resolveAccess = (repoId: string, method: string, path: string): number | null =>
    matchPath(dependencies.map.routesForRepo(repoId), method, path);

  /** The star a journal line pulses: its own request, else its logger, else the repo's entry file. */
  const resolveNode = (subject: UnitSubject, message: string): number => {
    const parsed = parseJournalMessage(message);

    if (parsed.method !== undefined && parsed.path !== undefined) {
      const hit = resolveAccess(subject.repoId, parsed.method, parsed.path);
      if (hit !== null) return hit;
    }
    if (parsed.logger !== undefined) {
      const node = dependencies.map.currentMap().loggers[parsed.logger];
      if (node !== undefined) return node;
    }
    // Neither shape: still a line from this unit, so it pulses where that unit's repo begins. `-1`
    // when even that is unknown, which the client renders as "nothing resolved" rather than a star.
    return dependencies.map.nodeIndexFor(subject.repoId, subject.entryFile);
  };

  /** The child, or `null`. Also the guard: `spawnChild` is not re-entered while one is live. */
  let child: ReturnType<typeof spawn> | null = null;
  let respawnTimer: NodeJS.Timeout | null = null;
  let attempts = 0;
  /** Whether the tap is following, and so whether a child that ends is one to bring back. */
  let running = false;

  /**
   * The reasons already reported, so a fault that repeats every thirty seconds says itself once.
   * Cleared when the child produces a line — a tap that recovered has earned a fresh alarm, and a
   * silence that never breaks would otherwise hide a second, different failure.
   */
  const said = new Set<string>();
  const reportOnce = (message: string): void => {
    if (said.has(message)) return;
    said.add(message);
    dependencies.logError(message);
  };

  const onLine = (line: string): void => {
    const record = parseJournalRecord(line);
    if (record === null) return;
    const subject = subjects.get(record.unit);
    if (subject === undefined) return;

    // A line is proof the child is alive and following, so both the ladder and the log throttle
    // start over from here.
    attempts = 0;
    said.clear();
    dependencies.push({
      node: resolveNode(subject, record.message),
      kind: 'exec',
      source: record.unit,
      at: Date.now(),
    });
  };

  const spawnChild = (): void => {
    const units = [...subjects.keys()];
    if (units.length === 0) {
      reportOnce('[Universe] the registry names no systemd units, so the journal tap follows nothing');
      return;
    }
    const args = ['-f', '-o', 'json', '-n', '0'];
    for (const unit of units) args.push('-u', unit);

    const spawned = spawn('journalctl', args);
    // Nothing is ever written to the child. Closing its stdin hands it an EOF instead of leaving a
    // pipe open that only this process could ever fill.
    spawned.stdin.end();
    child = spawned;

    let settled = false;
    let stderrTail = '';
    const settle = (reason: string): void => {
      if (settled) return;
      settled = true;
      if (child === spawned) child = null;
      // A child that ends because `stop()` killed it is not one to bring back.
      if (!running) return;

      const delay = RESPAWN_DELAYS_MS[Math.min(attempts, RESPAWN_DELAYS_MS.length - 1)];
      attempts += 1;
      reportOnce(`[Universe] the journal tap's child is gone (${reason}); respawning in ${delay} ms`);
      respawnTimer = setTimeout(() => {
        respawnTimer = null;
        spawnChild();
      }, delay);
      // Following a journal is not a reason for this process to stay alive, exactly as watching a
      // HEAD is not (`universe.module.ts`).
      respawnTimer.unref();
    };

    spawned.stderr.on('data', (chunk: Buffer) => {
      stderrTail = String(chunk).trim().split('\n').pop() ?? '';
    });
    // `error` covers a child that never started (a missing binary); `exit`, one that ran and ended.
    spawned.on('error', (error: Error) => settle(error.message));
    spawned.on('exit', (code: number | null, signal: NodeJS.Signals | null) =>
      settle(`${signal ?? `exit ${code}`}${stderrTail === '' ? '' : ` — ${stderrTail}`}`),
    );

    createInterface({ input: spawned.stdout }).on('line', onLine);
  };

  return {
    start: () => {
      // Idempotent: a second start while a child is live would put a second journalctl on the host
      // reading the same units.
      if (running) return;
      running = true;
      attempts = 0;
      subjects = buildSubjects(dependencies.registry());
      spawnChild();
    },

    stop: () => {
      if (!running) return;
      running = false;
      if (respawnTimer !== null) {
        clearTimeout(respawnTimer);
        respawnTimer = null;
      }
      // SIGTERM, not SIGKILL: the child holds no state worth keeping. Not WAITED for either — the
      // shutdown path exits as soon as this returns, so this asks the child to go rather than
      // proving it has. A child left behind by a SIGKILLed or OOM-killed server is what the
      // respawn ladder's bound in the phase's `pgrep` check is for, not something restored here.
      child?.kill('SIGTERM');
      child = null;
    },
  };
}
