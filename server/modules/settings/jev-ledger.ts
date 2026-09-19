import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The Jev ledger, totaled — the same sums `~/.claude/scripts/jev stats` prints.
 *
 * `~/.claude/hooks/jev_client.py` appends one JSON object per line to this file: one per call it
 * makes, plus a separate `filter_kept` line per filter carrying the lines in and the lines kept.
 * The panel shows the same four numbers the CLI shows so the token-savings claim can be read off
 * the UI instead of asserted, and so a switch turned on has something visible on the other side.
 */
const LEDGER_PATH = path.join(os.homedir(), '.claude', 'state', 'jev_ledger.jsonl');

/** What the ledger adds up to. `present` is false only while no call has ever been recorded. */
export type JevLedgerStats = {
  present: boolean;
  calls: number;
  tokens: number;
  linesIn: number;
  linesKept: number;
};

const EMPTY_LEDGER: JevLedgerStats = {
  present: false,
  calls: 0,
  tokens: 0,
  linesIn: 0,
  linesKept: 0,
};

/** A ledger field as a number, or zero: a line with a missing or non-numeric field still counts. */
function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_LEDGER;
    throw error;
  }

  const stats: JevLedgerStats = { ...EMPTY_LEDGER, present: true };
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
    // A `filter_kept` line is the filter's own result, not a second call — counted into the
    // line totals and kept out of the call and token totals, exactly as `jev stats` does.
    if (record.verb === 'filter_kept') {
      stats.linesIn += numberOrZero(record.lines_in);
      stats.linesKept += numberOrZero(record.lines_kept);
      continue;
    }
    stats.calls += 1;
    stats.tokens += numberOrZero(record.tokens);
  }
  return stats;
}
