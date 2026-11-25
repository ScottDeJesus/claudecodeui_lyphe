import { geminiMeterDb } from '@/modules/database/index.js';
import type { GeminiCallsDailyRow } from '@/modules/database/index.js';

import { costOf } from './gemini-rates.js';

/**
 * CloudCLI's own Gemini meter: the count of every request this server makes to Google, the switch per feature,
 * and the window's reading in the row shape the connector's door serves too (snake_case, so one row component draws
 * both). recordGeminiCall and geminiFeatureOff are what the voice module's wire calls on each ask; readUsage and
 * setFeatureSwitch are the two routes'.
 */

export const GEMINI_FEATURES = ['companion_speech', 'read_aloud', 'backup_transcription'] as const;
export type GeminiFeature = (typeof GEMINI_FEATURES)[number];

const FEATURE_LABELS: Record<GeminiFeature, string> = {
  companion_speech: 'Companion speech',
  read_aloud: 'Read aloud',
  backup_transcription: 'Backup transcription',
};

export const USAGE_RANGES = ['today', '7d', '30d'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];
const RANGE_DAYS: Record<UsageRange, number> = { today: 1, '7d': 7, '30d': 30 };

export type GeminiUsage = { inputTokens: number; outputTokens: number; inputAudioTokens: number; outputAudioTokens: number };

/** One answered or failed request. metered says the answer carried Google's own usage; usage may be derived without it. */
export type GeminiCall = {
  feature: GeminiFeature;
  model: string;
  keyId: string;
  keyTail: string;
  failed: boolean;
  usage: GeminiUsage | null;
  metered: boolean;
};

/** A key the account's calls can be sent with, by its digest and tail only. */
export type HeldGeminiKey = { keyId: string; keyTail: string; heldAs: 'house' | 'account' };

export type GeminiFeatureRow = {
  feature: GeminiFeature;
  label: string;
  enabled: boolean;
  calls: number;
  failures: number;
  unmeasured_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  models: string[];
  last_at: string | null;
};

export type GeminiKeyRow = { key: string; held_as: ('house' | 'account')[]; calls: number; cost_usd: number | null };

export type GeminiMeterUsage = {
  range: UsageRange;
  from: string;
  to: string;
  cost_basis: string;
  project: 'cloudcli';
  cost_usd: number | null;
  calls: number;
  features: GeminiFeatureRow[];
  days: { date: string; cost_usd: number | null }[];
  keys: GeminiKeyRow[];
  unpriced_models: string[];
};

const COST_BASIS =
  "An estimate: Google's published Standard-tier list prices on each call's day, times the tokens counted at CloudCLI's wire. No dollars are stored.";
/** Dollars are answered to a millionth: below that a figure is noise. */
const COST_SCALE = 1_000_000;

/** A feature's words, as the usage reading lists it and the voice wire's off sentence names it. */
export function geminiFeatureLabel(feature: GeminiFeature): string {
  return FEATURE_LABELS[feature];
}

export function isGeminiFeature(value: unknown): value is GeminiFeature {
  return typeof value === 'string' && (GEMINI_FEATURES as readonly string[]).includes(value);
}

export function isUsageRange(value: unknown): value is UsageRange {
  return typeof value === 'string' && (USAGE_RANGES as readonly string[]).includes(value);
}

/**
 * Counts one request: one upsert. Never throws, so a meter fault never takes a voice call down with it; a write
 * that fails is one warning naming the account, the feature, the model and the error's class (never its message,
 * which may quote the statement's values).
 */
export function recordGeminiCall(userId: number, call: GeminiCall): void {
  try {
    const now = new Date();
    const usage = call.usage;
    geminiMeterDb.addCall({
      userId,
      usageDate: utcDate(now),
      feature: call.feature,
      model: call.model,
      keyId: call.keyId,
      keyTail: call.keyTail,
      failed: call.failed,
      // metered_calls counts ANSWERED calls that carried Google's usage, so unmeasured_calls (calls - failures - metered) never subtracts a failure twice.
      metered: call.metered && !call.failed,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      inputAudioTokens: usage?.inputAudioTokens ?? 0,
      outputAudioTokens: usage?.outputAudioTokens ?? 0,
      at: now.toISOString(),
    });
  } catch (error) {
    console.warn('[gemini-meter] a Gemini call was not counted (user ' + userId + ', ' + String(call?.feature) + ', ' + String(call?.model) + '): ' + errorClassOf(error));
  }
}

/** Whether the account switched a feature off, read at the moment of the ask; no row means on. */
export function geminiFeatureOff(userId: number, feature: GeminiFeature): boolean {
  try {
    return geminiMeterDb.readSwitch(userId, feature) === false;
  } catch (error) {
    // A switch that cannot be read reads as on: a meter fault must never take a voice call down with it.
    console.warn('[gemini-meter] a Gemini switch could not be read (user ' + userId + ', ' + feature + '): ' + errorClassOf(error));
    return false;
  }
}

/** Sets a feature's switch and answers the state the table reads back. */
export function setFeatureSwitch(userId: number, feature: GeminiFeature, enabled: boolean): { feature: GeminiFeature; enabled: boolean } {
  geminiMeterDb.writeSwitch(userId, feature, enabled, new Date().toISOString());
  return { feature, enabled: geminiMeterDb.readSwitch(userId, feature) ?? true };
}

/** The account's spend over a window: its three features, its days, its keys (held or counted) and the models no rate prices. */
export function readUsage(userId: number, range: UsageRange, heldKeys: HeldGeminiKey[], now: Date = new Date()): GeminiMeterUsage {
  const dates = windowDates(range, now);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const rows = geminiMeterDb.rowsBetween(userId, from, to);
  const switches = geminiMeterDb.listSwitches(userId);

  return {
    range,
    from,
    to,
    cost_basis: COST_BASIS,
    project: 'cloudcli',
    cost_usd: costOfRows(rows),
    calls: sum(rows, (row) => row.calls),
    features: GEMINI_FEATURES.map((feature) => featureRow(feature, rows.filter((row) => row.feature === feature), switches.get(feature) ?? true)),
    days: dates.map((date) => ({ date, cost_usd: costOfRows(rows.filter((row) => row.usage_date === date)) })),
    keys: keyRows(rows, heldKeys),
    unpriced_models: [...new Set(rows.filter((row) => costOf(row) === null).map((row) => row.model))].sort(),
  };
}

function featureRow(feature: GeminiFeature, rows: GeminiCallsDailyRow[], enabled: boolean): GeminiFeatureRow {
  const lastAt = rows.reduce<string | null>((latest, row) => (latest === null || row.last_at > latest ? row.last_at : latest), null);
  return {
    feature,
    label: FEATURE_LABELS[feature],
    enabled,
    calls: sum(rows, (row) => row.calls),
    failures: sum(rows, (row) => row.failures),
    unmeasured_calls: sum(rows, (row) => Math.max(0, row.calls - row.failures - row.metered_calls)),
    input_tokens: sum(rows, (row) => row.input_tokens),
    output_tokens: sum(rows, (row) => row.output_tokens),
    cost_usd: costOfRows(rows),
    models: [...new Set(rows.map((row) => row.model))].sort(),
    last_at: lastAt,
  };
}

/** Every key held now and every key the window counted, by tail; held keys keep their place among equal counts. */
function keyRows(rows: GeminiCallsDailyRow[], heldKeys: HeldGeminiKey[]): GeminiKeyRow[] {
  const byId = new Map<string, { tail: string; heldAs: Set<'house' | 'account'>; rows: GeminiCallsDailyRow[] }>();
  for (const held of heldKeys) {
    const entry = byId.get(held.keyId) ?? { tail: held.keyTail, heldAs: new Set(), rows: [] };
    entry.heldAs.add(held.heldAs);
    byId.set(held.keyId, entry);
  }
  for (const row of rows) {
    const entry = byId.get(row.key_id) ?? { tail: row.key_tail, heldAs: new Set(), rows: [] };
    entry.rows.push(row);
    byId.set(row.key_id, entry);
  }
  return [...byId.values()]
    .map((entry) => ({ key: entry.tail, held_as: [...entry.heldAs], calls: sum(entry.rows, (row) => row.calls), cost_usd: costOfRows(entry.rows) }))
    .sort((a, b) => b.calls - a.calls);
}

/** Dollars of some rows: 0 for none, null when rows exist and no model of theirs has a rate, else the priced ones' sum. */
function costOfRows(rows: GeminiCallsDailyRow[]): number | null {
  if (rows.length === 0) return 0;
  const priced = rows.map(costOf).filter((cost): cost is number => cost !== null);
  if (priced.length === 0) return null;
  return Math.round(priced.reduce((total, cost) => total + cost, 0) * COST_SCALE) / COST_SCALE;
}

/** An error's class, never its message: a SQLite message can quote the statement's values. */
function errorClassOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : typeof error;
}

function sum(rows: GeminiCallsDailyRow[], valueOf: (row: GeminiCallsDailyRow) => number): number {
  return rows.reduce((total, row) => total + valueOf(row), 0);
}

/** The window's UTC dates, oldest first, ending today. */
function windowDates(range: UsageRange, now: Date): string[] {
  const days = RANGE_DAYS[range];
  const dates: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    dates.push(utcDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back))));
  }
  return dates;
}

function utcDate(moment: Date): string {
  return moment.toISOString().slice(0, 10);
}
