import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

/**
 * The subprocess side of the dispatcher lane: one `dispatcher status --json`, and the JSON body it
 * printed — and nothing about what the body MEANS.
 *
 * The dispatcher is a command, not a directory: this lane has no files to stat and no receipt to
 * classify, only one process to run and one document to parse. That document is printed whole by a
 * process that then exits (`hooks/dispatcher/cmd/status.py`), so unlike the run lane's files — which
 * a live runner may be replacing at this instant — there is no torn read to be patient with.
 *
 * The argv array is the whole command. No shell parses any of it, so nothing a plan is named could
 * become a second command; there is nothing here to quote.
 *
 * Every failure is a THROW carrying the dispatcher's own words, because "it did not answer" and
 * "it answered a refusal" are facts the journal has to tell apart, and the caller's contract
 * (`dispatcher-state.service.ts`) is to keep the last good picture rather than to guess.
 */

const execFileAsync = promisify(execFile);

/**
 * How much the document may weigh.
 *
 * A plan's `goal` is free text of any length and `report.py` carries it whole, so a store of a few
 * dozen plans runs to megabytes: the run lane's 1 MiB is not headroom enough here. Stated rather
 * than left to the default (`execFile`'s own is 1 MiB, and an overflow arrives as a string `code`,
 * never as a signal — the measured table is `runner-verb.service.ts:130`).
 */
const STATUS_MAX_BUFFER = 4 * 1024 * 1024;

/** How much of the dispatcher's own line a refusal carries: one line names the cause, and the rest is a traceback's tail. */
const FAILURE_LINE_CHARS = 200;

/** A child stream as a string. `execFile` answers `string` here, but a Buffer would render as "[object Object]". */
function readOutput(value: unknown): string {
  return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
}

/** A non-blank string, or `null`. */
function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** The first non-blank line of a child's output, trimmed and capped: the part of it that names a cause. */
function firstLine(value: unknown): string {
  const text = readText(value);
  if (text === null) return '';
  const line = text.split('\n').map((entry) => entry.trim()).find((entry) => entry.length > 0) ?? '';
  return line.slice(0, FAILURE_LINE_CHARS);
}

/**
 * What the dispatcher did instead of answering, in one sentence.
 *
 * The dispatcher's own words come first when it left any — a refusal on STDOUT (`no plan <bare>`,
 * exit 1), a traceback on stderr — because they name the cause better than an exit code does. The
 * ways it can fail without a code are the run lane's measured ways (`runner-verb.service.ts:130`:
 * our own ceiling and a kill from outside both arrive as a SIGNAL, a missing binary as a string
 * code), and they read differently on purpose: "was stopped" and "did not answer" are different
 * facts, and neither claims the read changed anything.
 */
function describeFailure(error: unknown): string {
  const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown; signal?: unknown };
  const said = firstLine(failure.stderr) || firstLine(failure.stdout);
  if (typeof failure.code === 'number' && Number.isFinite(failure.code)) {
    return `dispatcher status --json exited ${failure.code}${said ? `: ${said}` : ''}`;
  }
  if (typeof failure.signal === 'string') {
    return `dispatcher status --json was stopped before it answered (${failure.signal})`;
  }
  const because = error instanceof Error ? firstLine(error.message) : '';
  return `dispatcher status --json did not answer${said ? `: ${said}` : because ? `: ${because}` : ''}`;
}

// --------------------------- reading a field out of the body ---------------------------
//
// The vocabulary `dispatcher-state.service.ts` reads the document with. It lives here, beside the
// body it was parsed from, for the run lane's own reason: `runner-state.transport.ts` owns
// `readStringOrNull`, and the module that knows what the fields MEAN does not have to invent a
// `typeof` test for each one. What is different here is the direction of a bad field — these REFUSE
// it by name rather than coercing it to a default, because a body this lane cannot read is a
// different build of the dispatcher and not a torn file (see the service's head).

/** Text, and only text: `Object.is` semantics are not wanted — a boxed String is not a string. */
export const isText = (value: unknown): value is string => typeof value === 'string';

/** A number that renders as one. `typeof` alone admits `NaN`, and `Infinity` is not a cost. */
export const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A member of the document's two-valued and three-valued fields. */
export const isFlag = (value: unknown): value is boolean => typeof value === 'boolean';

/** A JSON object — never an array, which `typeof` calls one too. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A field the document may leave unset. */
export const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);

/** A field the document leaves unset when nothing has measured it (`ceiling`, `daemon.pid`). */
export const isCountOrNull = (value: unknown): value is number | null => value === null || isCount(value);

/** A JSON array. */
export const isList = (value: unknown): value is unknown[] => Array.isArray(value);

/** A record's field, without asserting the record is one — `undefined` for anything that is not a record. */
export function field(record: unknown, name: string): unknown {
  return isRecord(record) ? record[name] : undefined;
}

/**
 * A field that must be there, read through `ok`, or the body is refused BY NAME.
 *
 * The name is the field's path in the document (`plan.goal`, `stage.verdict`) and the name is the
 * whole point: the journal line says which field this build could not read, which is what turns "the
 * card went stale" into a one-glance diagnosis.
 */
export function need<T>(value: unknown, ok: (candidate: unknown) => candidate is T, where: string): T {
  if (!ok(value)) throw new Error(`dispatcher status --json answered no ${where}`);
  return value;
}

/** Every entry of a list, read through `read` — the list itself must be there. */
export function each<T>(value: unknown, where: string, read: (entry: unknown) => T): T[] {
  return need(value, isList, where).map(read);
}

/**
 * A count that a build OLDER than the field did not write, read as 0 — and refused by name when the
 * key is there but is not a count.
 *
 * This is the one tolerant read here, and the tolerance is exact: `undefined` is an absent KEY, which
 * is a different build of the dispatcher talking and not a torn or corrupted one — refusing a whole
 * plan because a field was invented after that build shipped would blank the operator's screen for a
 * reason that is not the reader's to punish. A key that IS there and is malformed is still refused,
 * which is the case this vocabulary exists for.
 */
export function countSince(value: unknown, where: string): number {
  return value === undefined ? 0 : need(value, isCount, where);
}

/** A list of names — a plan's waits, a phase's `start_here`. */
export function names(value: unknown, where: string): string[] {
  return each(value, where, (entry) => need(entry, isText, where));
}

/** One word out of a closed vocabulary — the document's status words and its two providers. */
export function oneOf<T extends string>(value: unknown, words: readonly T[], where: string): T {
  const word = need(value, isText, where);
  if (!(words as readonly string[]).includes(word)) {
    throw new Error(`dispatcher status --json answered the ${where} ${word}`);
  }
  return word as T;
}

/**
 * One `dispatcher status --json`, as the parsed body.
 *
 * `cwd` is the home directory rather than this repository: the dispatcher resolves its own store from
 * `DISPATCHER_HOME`/`$HOME` (`hooks/dispatcher/store.py:home`), and a read must never be interpreted
 * against whatever working tree the server happened to be started in. `env` comes from the caller —
 * `dispatcher.module.ts` is the one place that reads the environment.
 */
export async function readDispatcherDocument(
  bin: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  let stdout: string;
  try {
    const answer = await execFileAsync(bin, ['status', '--json'], {
      timeout: timeoutMs,
      maxBuffer: STATUS_MAX_BUFFER,
      env,
      cwd: os.homedir(),
    });
    stdout = readOutput(answer.stdout);
  } catch (error) {
    throw new Error(describeFailure(error));
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error('dispatcher status --json did not answer JSON');
  }
}
