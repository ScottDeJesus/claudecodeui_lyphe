import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The Jev ledger, totaled — the same sums `~/.claude/scripts/jev stats` prints.
 *
 * `~/.claude/hooks/jev_client.py` appends one JSON object per line to this file: one per call it
 * makes, plus a `filter_kept` line per filter carrying the lines in and the lines kept, plus a
 * `saved` line whenever a caller's answer changed what reached a session's context. The panel shows
 * the same numbers the CLI shows so the token-savings claim can be read off the UI instead of
 * asserted, and so a switch turned on has something visible on the other side.
 */
const LEDGER_PATH = path.join(os.homedir(), '.claude', 'state', 'jev_ledger.jsonl');

/**
 * The account the operator seeded by hand (`credit_usd`), because TypeSafe publishes no balance
 * route: its API is `/v1/systemone` and `/v1/models` and nothing else. `unledgered_tokens` are
 * calls that were made and later purged from the ledger, so a purge never refunds money.
 */
const ACCOUNT_PATH = path.join(os.homedir(), '.claude', 'state', 'jev_account.json');

/** What is left of the seeded credit, by this host's own metering — an estimate, and named as one on screen. */
export type JevBalance = { creditUsd: number; spentUsd: number; leftUsd: number };

async function readJevBalance(ledgerTokens: number): Promise<JevBalance | null> {
  try {
    const account = JSON.parse(await readFile(ACCOUNT_PATH, 'utf8')) as Record<string, unknown>;
    const credit = account.credit_usd;
    const price = account.usd_per_mtok;
    if (typeof credit !== 'number' || typeof price !== 'number' || !Number.isFinite(credit) || !Number.isFinite(price)) {
      return null;
    }
    const spentUsd = ((ledgerTokens + numberOrZero(account.unledgered_tokens)) * price) / 1e6;
    return { creditUsd: credit, spentUsd, leftUsd: credit - spentUsd };
  } catch {
    return null; // no seeded account is "no balance to draw", never a zero
  }
}

/**
 * One consumer's net effect on what sessions read, in characters: positive for text kept OUT of a
 * session's context, negative for text ADDED to it. `caller` is the name that consumer passes to
 * Jev (`hook:route_artifact_word`), so this is the row `~/.claude/scripts/jev stats` prints.
 */
export type JevConsumerNet = {
  caller: string;
  chars: number;
};

/** What the ledger adds up to. `present` is false only while no call has ever been recorded. */
export type JevLedgerStats = {
  present: boolean;
  calls: number;
  tokens: number;
  linesIn: number;
  linesKept: number;
  /** Every consumer's net together: the `NET context` line of `jev stats`, in characters. */
  netChars: number;
  /** The same total split by consumer, largest first — that command's per-caller lines. */
  byCaller: JevConsumerNet[];
  /** `null` until the operator seeds `jev_account.json`. */
  balance: JevBalance | null;
};

const EMPTY_LEDGER: JevLedgerStats = {
  present: false,
  calls: 0,
  tokens: 0,
  linesIn: 0,
  linesKept: 0,
  netChars: 0,
  byCaller: [],
  balance: null,
};

/** A ledger field as a number, or zero: a line with a missing or non-numeric field still counts. */
function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The consumer a `saved` line is filed under. A nameless one is `unknown`, as the CLI files it. */
function callerOf(record: Record<string, unknown>): string {
  return typeof record.caller === 'string' && record.caller ? record.caller : 'unknown';
}

/**
 * Totals the ledger file.
 *
 * A missing file is not a fault — it is "no call yet", which is exactly what a house that has never
 * turned Jev on should read — so an ENOENT answers with zeros. Any OTHER read failure is thrown:
 * a permissions error dressed as an empty ledger would tell the operator their calls were free.
 */
export async function readJevLedgerStats(): Promise<JevLedgerStats> {
  let raw: string;
  try {
    raw = await readFile(LEDGER_PATH, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY_LEDGER, balance: await readJevBalance(0) };
    throw error;
  }

  const stats: JevLedgerStats = { ...EMPTY_LEDGER, present: true };
  // Accumulated in a map and turned into a fresh array at the end: `EMPTY_LEDGER`'s array is shared
  // module state, and a push into it would outlive this call.
  const savedBy = new Map<string, number>();

  for (const line of raw.split('\n')) {
    let entry: unknown;
    // A line another process was mid-append on, or a stray scalar: skipped, never fatal. The
    // Python reader (`cmd_stats`) skips both the same way.
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;

    const record = entry as Record<string, unknown>;
    // A `saved` line is a REPORT about a call, not a call — counted into the per-consumer net and
    // kept out of the call and token totals, exactly as `jev stats` keeps it.
    if (record.verb === 'saved') {
      const caller = callerOf(record);
      savedBy.set(caller, (savedBy.get(caller) ?? 0) + numberOrZero(record.chars_saved));
      continue;
    }
    // A `filter_kept` line is the filter's own result, likewise not a second call — counted into the
    // line totals and kept out of the call and token totals, exactly as `jev stats` does.
    if (record.verb === 'filter_kept') {
      stats.linesIn += numberOrZero(record.lines_in);
      stats.linesKept += numberOrZero(record.lines_kept);
      continue;
    }
    stats.calls += 1;
    stats.tokens += numberOrZero(record.tokens);
  }

  stats.byCaller = [...savedBy]
    .map(([caller, chars]) => ({ caller, chars }))
    .sort((left, right) => right.chars - left.chars);
  stats.netChars = stats.byCaller.reduce((total, consumer) => total + consumer.chars, 0);
  stats.balance = await readJevBalance(stats.tokens);
  return stats;
}
