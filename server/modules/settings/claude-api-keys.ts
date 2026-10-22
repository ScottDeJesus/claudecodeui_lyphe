import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import type { ClaudeApiPicture, ClaudeApiUnreadable } from '@/shared/types.js';
import { AppError, expandHome } from '@/shared/utils.js';

import { kickDispatcher } from './dispatcher-kick.js';

const execFileAsync = promisify(execFile);

/**
 * The Claude API keys' own front door (`~/.claude/scripts/claude-api`), resolved exactly as
 * `dispatcher-kick.ts` resolves the dispatcher two lines over: `CLAUDE_API_BIN` moves it for a
 * probe; the default is where the house installs it.
 */
const DEFAULT_BIN = '~/.claude/scripts/claude-api';

/**
 * How long a door answer may take before it is given up on. A status read and a store write both
 * answer at once — two small files, and for the picture a sqlite ledger read — so this is a bound
 * on a door that is stuck, never a wait anybody is meant to sit through.
 */
const DOOR_TIMEOUT_MS = 10_000;

/**
 * The whole picture is a few kilobytes; `execFile`'s 1 MiB default is ample. Named so a future
 * picture cannot silently outgrow a bound nobody chose.
 */
const DOOR_MAX_BUFFER = 1024 * 1024;

/**
 * Anything shaped like a Claude API key of any kind (api, admin, oat), blanked from every string
 * this module relays. The door holds to that rule itself, but the server's answer is a second seam:
 * a stand-in door that echoed its stdin, or a hand-edited store, can put no key in a picture, a
 * refusal or an error this module returns.
 */
const KEY_SHAPE = /sk-ant-[A-Za-z0-9_-]{8,}/g;

/**
 * One save as the settings route hands it over (the route validates the shapes first). An omitted
 * field keeps what the slot holds; `renewsDay: null` clears the renewal day deliberately; `key` is
 * present only when the reader typed a new one.
 */
export type ClaudeApiKeySave = {
  key?: string;
  label?: string;
  creditUsd?: number;
  renewsDay?: number | null;
};

/** One door answer, gathered to the end: its exit code (null when a signal ended it), its two streams, and whether the bound killed it. */
type DoorAnswer = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

/** The door's absolute path, this call: the probe seam when set, else the installed verb. */
function doorBin(): string {
  return expandHome(process.env.CLAUDE_API_BIN || DEFAULT_BIN);
}

/** `text` with anything key-shaped blanked — the one thing this module may never relay. */
function redact(text: string): string {
  return text.replace(KEY_SHAPE, '[key]');
}

/**
 * The picture with every string in it passed through `redact` — labels, wall details, the reason
 * who rides, the models a key paid for. The door is one seam; the answer this server gives is the
 * other, and a picture is an answer: nothing key-shaped reaches the card even when the door it was
 * read from was a stand-in, or the store behind it was edited by hand.
 */
function redactPicture(picture: ClaudeApiPicture): ClaudeApiPicture {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, walk(entry)]));
    }
    return value;
  };
  return walk(picture) as ClaudeApiPicture;
}

/**
 * Whether a parsed status answer is the picture this server promises to relay. A door that
 * answered malformed JSON, or JSON of another shape, is a read FAILURE, not a picture half drawn.
 */
function isPicture(value: unknown): value is ClaudeApiPicture {
  if (typeof value !== 'object' || value === null) return false;
  const picture = value as {
    rides?: unknown;
    keys?: unknown;
    pace_usd_per_hour?: unknown;
    unpriced?: unknown;
    checked_at?: unknown;
  };
  return typeof picture.rides === 'object' && picture.rides !== null
    && Array.isArray(picture.keys)
    && typeof picture.pace_usd_per_hour === 'number'
    && Array.isArray(picture.unpriced)
    && typeof picture.checked_at === 'number';
}

/**
 * The door's picture of who pays for a plan run — `claude-api status --json`, relayed whole.
 *
 * A read answers `{ unreadable: true }` on EVERY failure — no verb, a non-zero exit, the bound, a
 * body that is not the picture — because the card draws "unknown" in words and must never draw
 * "not set" for settings it could not see (INV-8936). A read creates nothing and writes nothing;
 * the door's own read of a missing store answers an empty store. A picture that IS the picture is
 * relayed through `redactPicture`, so no key-shaped string leaves this server.
 *
 * Used by `settings.routes.ts` (`GET /claude-api`) and by both writes below, which answer the fresh
 * picture rather than echoing the body.
 */
export async function readClaudeApi(): Promise<ClaudeApiPicture | ClaudeApiUnreadable> {
  try {
    const { stdout } = await execFileAsync(doorBin(), ['status', '--json'], {
      timeout: DOOR_TIMEOUT_MS,
      maxBuffer: DOOR_MAX_BUFFER,
    });
    const picture: unknown = JSON.parse(stdout);
    return isPicture(picture) ? redactPicture(picture) : { unreadable: true };
  } catch {
    return { unreadable: true };
  }
}

/**
 * Run one door verb and gather its answer. Stdin is a PIPE, and the caller's line is written to it
 * and it is closed at once: a door waiting for the key read gets its segment before the child can
 * look for it, and one that takes no key sees EOF rather than a stream left open.
 *
 * Nothing here rejects. A spawn that never happened (`ENOENT`), a signal, and the bound each
 * answer a shape the caller words for itself; the exit code is the verdict in every other case.
 */
function runDoor(args: string[], stdin: string | null): Promise<DoorAnswer> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (answer: DoorAnswer): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(answer);
    };

    const child = spawn(doorBin(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ code: null, stdout, stderr, timedOut: true });
    }, DOOR_TIMEOUT_MS);

    // The stdio above guarantees both pipes, but the typings still give each as `… | null`.
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    // A door that exits before reading its stdin makes the write fail with EPIPE; its exit code is
    // the answer, so the stream's own complaint is heard and dropped.
    child.stdin?.on('error', () => undefined);
    child.on('error', () => finish({ code: null, stdout, stderr, timedOut: false }));
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut: false }));

    if (stdin === null) child.stdin?.end();
    else child.stdin?.end(stdin);
  });
}

/** The one sentence a 502 carries: the door's own stderr line, or why there is none. */
function doorFailure(answer: DoorAnswer): string {
  const said = redact(answer.stderr.trim());
  if (said) return said;
  return answer.timedOut
    ? 'the claude-api door did not answer in time'
    : 'the claude-api door did not answer';
}

/**
 * One write, then the fresh picture. A REFUSED door answer (exit 2, `REFUSED key <n>: <rule>`) is
 * a 422 carrying the door's own words with the protocol word stripped; every other failure is a
 * 502 carrying its one stderr line, which names an exception class and nothing else. A save whose
 * walls could not be lifted is such a failure by class (`WallsStand`), never a SAVED.
 *
 * THE WRITE IS THE EVENT: a save clears that key's walls, and the dispatcher's release asks whether
 * another payer now carries a plan (`account_release.py`), so every attempted write ends with
 * `void kickDispatcher()`, exactly as the switches beside it do. That includes a FAILED write: the
 * door writes the key and settings BEFORE it lifts the walls, so a failed lift (`WallsStand`, exit 1)
 * has already landed the save and may have freed a plan. Only a REFUSED answer — which wrote
 * nothing — kicks nothing.
 */
async function writeDoor(args: string[], stdin: string | null): Promise<ClaudeApiPicture | ClaudeApiUnreadable> {
  const answer = await runDoor(args, stdin);
  if (answer.code === 0) {
    const picture = await readClaudeApi();
    void kickDispatcher();
    return picture;
  }
  const refused = redact(answer.stdout.trim());
  if (answer.code === 2 && refused.startsWith('REFUSED ')) {
    throw new AppError(refused.slice('REFUSED '.length), {
      code: 'CLAUDE_API_KEY_REFUSED',
      statusCode: 422,
    });
  }
  void kickDispatcher();
  throw new AppError(doorFailure(answer), {
    code: 'CLAUDE_API_DOOR_FAILED',
    statusCode: 502,
  });
}

/**
 * Save a key and/or a slot's settings through the door, and answer the picture read back.
 *
 * THE KEY REACHES ONE PLACE: `--key-stdin` asks the door for it, and the line is written to the
 * child's stdin. It is never an argument (a process list is world-readable), never an environment
 * value (a child hands it on), and never part of this function's answer or any error above it.
 * `renewsDay: null` is `--renews none`; an omitted day leaves the slot's day alone.
 *
 * Used by `settings.routes.ts` (`PUT /claude-api/:slot`); the route has already refused a slot that
 * is not 1 or 2 and a body whose field shapes the door could not be asked with.
 */
export async function saveClaudeApiKey(
  slot: number,
  input: ClaudeApiKeySave,
): Promise<ClaudeApiPicture | ClaudeApiUnreadable> {
  const args = ['set', String(slot)];
  if (input.key !== undefined) args.push('--key-stdin');
  if (input.label !== undefined) args.push('--label', input.label);
  if (input.creditUsd !== undefined) args.push('--credit', String(input.creditUsd));
  if (input.renewsDay !== undefined) {
    args.push('--renews', input.renewsDay === null ? 'none' : String(input.renewsDay));
  }
  return writeDoor(args, input.key === undefined ? null : `${input.key}\n`);
}

/**
 * Delete a slot's key and settings through the door, clear its walls, and answer the picture read
 * back. Idempotent, as the door is: removing an empty slot changes nothing and still answers.
 *
 * Used by `settings.routes.ts` (`DELETE /claude-api/:slot`).
 */
export async function removeClaudeApiKey(slot: number): Promise<ClaudeApiPicture | ClaudeApiUnreadable> {
  return writeDoor(['remove', String(slot)], null);
}
