import { createHash } from 'node:crypto';
import path from 'node:path';

import type { CronJob, CronJobOrigin } from '@/shared/types.js';

import { describeCron } from './schedules-cron-describe.js';
import type { SeenCronLine } from './schedules-cron-read.service.js';

/**
 * The registry against the box: what to write, and what has gone.
 *
 * PURE. It takes the tracked rows, what was read off the box and what the journal saw, and it
 * returns the rows to write — no database, no subprocess, no clock of its own (`now` arrives as
 * an argument, so the same input always produces the same output, which is what lets the three
 * drift rules be proved against handmade input instead of against the operator's real crontab).
 * It mutates neither argument: a write that fails afterwards must leave the in-memory registry
 * exactly as it was, never half-changed and unsalvageable.
 *
 * Three things happen to a line the box showed, and the difference between them is the whole
 * point of the registry:
 *
 *   - no tracked row has its id          -> ADOPTED: the registry gains it, named from its command;
 *   - a tracked row differs in expression or command -> CHANGED, with the move spelled out;
 *   - a tracked row matches it           -> carried through, and its STORED drift kept.
 *
 * That last rule is the one that is easy to get wrong. Drift is STICKY: a job edited outside the
 * door keeps saying so until the door itself clears it, because the door is the only thing that
 * knows the edit was meant. Recomputing a match to `drift: 'none'` here would launder an outside
 * edit within one fifteen-minute cadence, and the screen's adopted and changed badges would go
 * permanently dark — the registry would keep the row and lose the reason anyone opened it.
 *
 * A row the box no longer shows is MARKED, never deleted: what left the box is exactly what the
 * registry exists to remember. Rows of kind `scheduled-prompt` are not cron lines and are never
 * touched here — the box has nothing to compare them against.
 */

export type ReconcileCounts = {
  seen: number;
  adopted: number;
  missing: number;
  changed: number;
};

export type ReconcileResult = {
  upserts: CronJob[];
  missingIds: string[];
  counts: ReconcileCounts;
};

/** A redirection standing alone (`>`, `>>`, `2>`), whose NEXT token is the file it writes. */
const REDIRECT_OPERATOR = /^\d?(>>|>)$/;

/** A redirection glued to its target (`>>/var/log/x.log`): the whole token is that file. */
const REDIRECT_GLUED = /^\d?(>>|>).+/;

/** A shell separator or brace — glued to commands, never an argument of one. */
const SHELL_OPERATOR = /^(&&|\|\||[|;(){}<>])+$/;

/** A token that names a file by path: it holds a separator, with something after the last one. */
function isPathLike(token: string): boolean {
  const lastSeparator = token.lastIndexOf('/');
  return lastSeparator !== -1 && lastSeparator < token.length - 1;
}

/** Whether a token could be a command's argument: a word, not a flag, not a path, not a separator. */
function isPlainWord(token: string): boolean {
  if (token === '' || SHELL_OPERATOR.test(token)) return false;
  return !/^[-<>]/.test(token) && !token.includes('=') && !token.includes('/');
}

/**
 * The tokens that could name a program, with every redirection dropped.
 *
 * A redirection's target is a file the command writes, not the command's own name — without this,
 * `… command -v debian-sa1 > /dev/null && …` names its row "Null" after the bit-bucket it throws
 * output into. The operator's own `>>` log file would read as the name of the job that writes it.
 */
function programTokens(tokens: string[]): string[] {
  const kept: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (REDIRECT_GLUED.test(token) && !REDIRECT_OPERATOR.test(token)) continue;
    if (REDIRECT_OPERATOR.test(token)) {
      index += 1; // The next token is the file this writes; skip it with the operator.
      continue;
    }

    kept.push(token);
  }

  return kept;
}

/** A command's own words as one Title Cased handle: `runner-watchdog` reads back as "Runner Watchdog". */
function titleCase(word: string): string {
  return word
    .split(/[-_.]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/**
 * The name a freshly adopted row carries: what the command runs, then what it is told to do.
 *
 * Deliberately literal — the basename of the command's first path-like token, Title Cased, plus
 * the word after it when that word is an argument. It is a handle, not a summary, and the row
 * shows the whole command beside it for the cases this cannot read well (a shell one-liner whose
 * first path belongs to a `test`, say). A name nobody chose is still better than a blank one.
 */
function deriveName(command: string): string {
  const tokens = programTokens(command.split(/\s+/).filter((token) => token !== ''));
  const headIndex = tokens.findIndex(isPathLike);
  const head = headIndex === -1 ? (tokens[0] ?? '') : path.basename(tokens[headIndex]);
  const name = titleCase(head);

  const next = tokens[(headIndex === -1 ? 0 : headIndex) + 1] ?? '';
  const argument = isPlainWord(next) ? next : '';

  if (name === '') return argument === '' ? command : argument;
  return argument === '' ? name : `${name} ${argument}`;
}

/**
 * The row's id, exactly as the contract declares every registry id: the kind, the origin, and the
 * first twelve hex digits of the command's SHA-1. Only the COMMAND is hashed, so the same line
 * moved between tables keeps its identity and a changed command is a different job.
 */
function cronJobId(origin: CronJobOrigin, command: string): string {
  const digest = createHash('sha1').update(command).digest('hex').slice(0, 12);
  return `cron:${origin}:${digest}`;
}

/** What moved under a tracked row, in one clause per move — null when nothing did. */
function movedDetail(tracked: CronJob, line: SeenCronLine): string | null {
  const moves: string[] = [];

  if (tracked.expression !== line.expression) {
    moves.push(`schedule was \`${tracked.expression}\`, now \`${line.expression}\``);
  }
  if (tracked.command !== line.command) {
    moves.push(`command was \`${tracked.command}\`, now \`${line.command}\``);
  }

  return moves.length === 0 ? null : moves.join('; ');
}

/**
 * What to write, given what is tracked and what the box showed.
 *
 * `now` is the sync's own timestamp, passed in so this stays a function of its arguments; it
 * stamps `updatedAt` on every row and `trackedAt` on the ones the registry is gaining.
 */
export function reconcile(
  stored: CronJob[],
  seen: SeenCronLine[],
  invocations: Map<string, string>,
  now: string
): ReconcileResult {
  const trackedById = new Map<string, CronJob>();
  for (const job of stored) {
    if (job.kind === 'cron') trackedById.set(job.id, job);
  }

  const upserts: CronJob[] = [];
  const matched = new Set<string>();
  let adopted = 0;
  let changed = 0;

  // Two lines can carry one command — a duplicated crontab line — and the id hashes only the
  // command, so they are ONE row the registry gains. `adopted` counts rows gained, not lines seen; the line count is `seen`.
  const gained = new Set<string>();

  for (const line of seen) {
    const id = cronJobId(line.origin, line.command);
    matched.add(id);

    const tracked = trackedById.get(id);
    const lastRunAt = invocations.get(line.command) ?? null;

    const row: CronJob = {
      id,
      kind: 'cron',
      name: tracked?.name ?? deriveName(line.command),
      purpose: tracked?.purpose ?? null,
      tags: tracked?.tags ?? [],
      owner: line.owner,
      origin: line.origin,
      expression: line.expression,
      scheduleText: describeCron(line.expression),
      command: line.command,
      logPath: line.logPath,
      state: 'ok',
      drift: 'none',
      driftDetail: null,
      lastRunAt,
      lastResult: lastRunAt === null ? null : 'invoked',
      nextRunAt: null,
      note: line.note,
      source: line.source,
      trackedAt: tracked?.trackedAt ?? now,
      updatedAt: now,
    };

    if (tracked === undefined) {
      if (!gained.has(id)) {
        gained.add(id);
        adopted += 1;
      }
      upserts.push({ ...row, drift: 'adopted' });
      continue;
    }

    const detail = movedDetail(tracked, line);
    if (detail !== null) changed += 1;

    upserts.push({
      ...row,
      drift: detail === null ? tracked.drift : 'changed',
      driftDetail: detail ?? tracked.driftDetail,
    });
  }

  const missingIds = [...trackedById.keys()].filter((id) => !matched.has(id));

  return {
    upserts,
    missingIds,
    counts: { seen: seen.length, adopted, missing: missingIds.length, changed },
  };
}
