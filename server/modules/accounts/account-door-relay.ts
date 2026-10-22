import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { ClaudeAccountsPicture } from '@/shared/types.js';
import { AppError, expandHome } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);

/**
 * The account door's TWO relay faces — the picture the panel draws and the three writes that move
 * the choice — split from `account-door.ts` so the credential pipe (a FIFO protocol with its own
 * measured quirks) and the plain one-shot relays stay in their own files.
 *
 * THE PICTURE IS RELAYED UNCHANGED, as `claude-api-keys.ts` relays the API keys' door: every string
 * is passed through `redact` first, because this server's answer is the second seam and a stand-in
 * door, or a hand-edited store, can put nothing key-shaped in a picture, a refusal or an error.
 *
 * A READ NEVER FAILS. `status --json` answering a missing binary, a non-zero exit, the bound or a
 * body that is not the picture is the panel's calm `{reachable:false, reason}` — this read rides the
 * status chip. `reason` reuses the client's own vocabulary: `timeout` and `bad-response` have
 * sentences of their own, and everything else is the plain "not reachable".
 *
 * A WRITE'S VERDICT IS THE DOOR'S. Exit 0 answers the door's line (`USING <slug>`, `AUTO on`,
 * `REMOVED <slug>`); exit 2 with a `REFUSED` line is `AccountDoorRefusal` carrying the door's
 * sentence, so `accounts.routes.ts` answers it as a 422 exactly as it answers the slot store's
 * `AccountRefusal`; every other failure is a 502 whose sentence is the door's one stderr line,
 * redacted. `use` and `remove` kick the dispatcher inside the door itself (INV-187) — no kick here.
 */
const DEFAULT_BIN = '~/.claude/scripts/claude-account';

/** A status read and a write answer at once; this bounds a door that is stuck, nobody waits it out. */
export const DOOR_TIMEOUT_MS = 10_000;

/** The picture is a few kilobytes; `execFile`'s 1 MiB default is ample. Named so a future picture
 *  cannot silently outgrow a bound nobody chose. */
const DOOR_MAX_BUFFER = 1024 * 1024;

/** Any Claude key of any kind (api, admin, oat), blanked from every string this module relays. */
const KEY_SHAPE = /sk-ant-[A-Za-z0-9_-]{8,}/g;

/** The door's absolute path, this call: the probe seam when set, else the installed verb. */
export function doorBin(): string {
  return expandHome(process.env.CLAUDE_ACCOUNT_BIN || DEFAULT_BIN);
}

/** `text` with anything key-shaped blanked — the one thing this module may never relay. */
export function redact(text: string): string {
  return text.replace(KEY_SHAPE, '[key]');
}

/**
 * The door refused a WRITE in its own words (`REFUSED …`, exit 2) — a refusal the operator can act
 * on, carried as a class so the routes answer it as a 422. The protocol word is stripped; the
 * sentence is the door's own.
 */
export class AccountDoorRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountDoorRefusal';
  }
}

/**
 * The picture with every string in it passed through `redact` — slugs, a wall's kind, a reading's
 * source, the rule's words. A picture is an answer, so the redaction reaches all of it, not only the
 * strings somebody remembered to look at.
 */
function redactPicture(picture: ClaudeAccountsPicture): ClaudeAccountsPicture {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, walk(entry)]));
    }
    return value;
  };
  return walk(picture) as ClaudeAccountsPicture;
}

/**
 * Whether a parsed status answer is the picture the panel is built on. A door that answered
 * malformed JSON, or JSON of another shape, is a read FAILURE, not a picture half drawn.
 */
function isPicture(value: unknown): value is ClaudeAccountsPicture {
  if (typeof value !== 'object' || value === null) return false;
  const picture = value as {
    accounts?: unknown;
    candidates?: unknown;
    auto?: unknown;
    held?: unknown;
    chosen?: unknown;
    last_switch?: unknown;
  };
  return Array.isArray(picture.accounts)
    && Array.isArray(picture.candidates)
    && typeof picture.auto === 'boolean'
    && typeof picture.held === 'boolean'
    && (picture.chosen === null || typeof picture.chosen === 'object')
    && (picture.last_switch === null || typeof picture.last_switch === 'object');
}

/**
 * The panel's picture — `claude-account status --json`, relayed whole. Used by
 * `accounts.routes.ts` (`GET /api/accounts`), which carries it beside the slot summary under `door`.
 * A read creates nothing and writes nothing; the door's own read of a missing store answers an
 * empty picture.
 */
export async function accountsPicture(): Promise<ClaudeAccountsPicture | { reachable: false; reason: string }> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(doorBin(), ['status', '--json'], {
      timeout: DOOR_TIMEOUT_MS,
      maxBuffer: DOOR_MAX_BUFFER,
    }));
  } catch (error) {
    const killed = (error as { killed?: unknown } | null)?.killed === true;
    return { reachable: false, reason: killed ? 'timeout' : 'unreachable' };
  }
  try {
    const picture: unknown = JSON.parse(stdout);
    return isPicture(picture) ? redactPicture(picture) : { reachable: false, reason: 'bad-response' };
  } catch {
    return { reachable: false, reason: 'bad-response' };
  }
}

/**
 * Run one door WRITE and answer its line. `execFile`'s rejection for a non-zero exit carries both
 * streams and the exit code; anything else (ENOENT, a signal, the bound) carries no verdict and is
 * the failure below. The write did not land, so unlike a read it must not answer as one that did.
 */
export async function writeDoor(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(doorBin(), args, {
      timeout: DOOR_TIMEOUT_MS,
      maxBuffer: DOOR_MAX_BUFFER,
    });
    return redact(stdout.trim());
  } catch (error) {
    const answer = error as { code?: unknown; stdout?: unknown; stderr?: unknown; killed?: unknown };
    const refused = typeof answer.stdout === 'string' ? redact(answer.stdout.trim()) : '';
    if (answer.code === 2 && /^REFUSED\b/.test(refused)) {
      throw new AccountDoorRefusal(refused.replace(/^REFUSED:?\s*/, ''));
    }
    const said = typeof answer.stderr === 'string' ? redact(answer.stderr.trim()) : '';
    throw new AppError(
      said || (answer.killed === true
        ? 'the claude-account door did not answer in time'
        : 'the claude-account door did not answer'),
      { code: 'CLAUDE_ACCOUNT_DOOR_FAILED', statusCode: 502 },
    );
  }
}
