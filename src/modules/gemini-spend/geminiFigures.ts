import type { ConnectorUsage, GeminiDoor, KeyRow, MeterUsage } from '@/modules/gemini-spend/types';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const COUNT = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** "$2.31", always two places so a column reads as one unit; "<$0.01" for a cost that is not nothing; "—" for no rate. */
export function usdWords(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  if (amount > 0 && amount < 0.005) return '<$0.01';
  return USD.format(amount);
}

/** "1,280". */
export function countWords(count: number): string {
  return COUNT.format(count);
}

/** "940", "182K", "4.1M". */
export function tokenWords(tokens: number): string {
  return COMPACT.format(tokens);
}

/** The words a call count takes: one call, or several. */
export function callsKey(calls: number): string {
  return calls === 1 ? 'api.gemini.row.call' : 'api.gemini.row.calls';
}

/** A switch's name in the view's held set: a feature key is only unique inside its own door. */
export function switchId(door: GeminiDoor, feature: string): string {
  return door + ':' + feature;
}

/** One UTC day across both doors. A series whose door did not answer is null, never a zero. */
export type GeminiDay = { day: string; features: number | null; budgets: number | null; cloudcli: number | null };

/** Every day either door listed, oldest first. A day a door that answered did not list is that door's zero. */
export function daysOf(connector: ConnectorUsage | null, meter: MeterUsage | null): GeminiDay[] {
  const dates = new Set<string>();
  connector?.days.forEach((entry) => dates.add(entry.date));
  meter?.days.forEach((entry) => dates.add(entry.date));
  return Array.from(dates)
    .sort()
    .map((day) => {
      const fromConnector = connector?.days.find((entry) => entry.date === day);
      const fromMeter = meter?.days.find((entry) => entry.date === day);
      return {
        day,
        features: connector ? (fromConnector?.production_usd ?? 0) : null,
        budgets: connector ? (fromConnector?.budgets_usd ?? 0) : null,
        cloudcli: meter ? (fromMeter?.cost_usd ?? 0) : null,
      };
    });
}

/** One key across both doors: what the connector's process holds it as, what CloudCLI holds it as, and both counts summed. */
export type GeminiKey = { key: string; envNames: string[]; meterHolders: string[]; calls: number; cost_usd: number | null };

/**
 * Every key either door listed, by its last four, the busiest first. One key counted at both wires is one row with
 * both counts summed: Google's figure for a key is all of its use, so that sum is what it is held against.
 */
export function keysOf(connector: ConnectorUsage | null, meter: MeterUsage | null): GeminiKey[] {
  const byTail = new Map<string, GeminiKey>();
  const take = (row: KeyRow, door: GeminiDoor) => {
    const held = byTail.get(row.key) ?? { key: row.key, envNames: [], meterHolders: [], calls: 0, cost_usd: null };
    byTail.set(row.key, {
      key: row.key,
      envNames: door === 'connector' ? [...held.envNames, ...row.held_as] : held.envNames,
      meterHolders: door === 'meter' ? [...held.meterHolders, ...row.held_as] : held.meterHolders,
      calls: held.calls + row.calls,
      cost_usd: held.cost_usd === null ? row.cost_usd : held.cost_usd + (row.cost_usd ?? 0),
    });
  };
  connector?.keys.forEach((row) => take(row, 'connector'));
  meter?.keys.forEach((row) => take(row, 'meter'));
  return Array.from(byTail.values()).sort((a, b) => b.calls - a.calls);
}

/** "Nov 24, 14:02" in the reader's own zone: when an answer landed. Null for a time that is not one. */
export function readWords(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
