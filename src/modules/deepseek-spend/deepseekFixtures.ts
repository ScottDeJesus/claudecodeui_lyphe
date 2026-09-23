import type { DeepseekDay, DeepseekKind, DeepseekOuting, DeepseekRange, DeepseekReconHour, DeepseekUsageSummary } from '@/shared/types';

/**
 * The DeepSeek view's SAMPLE reading — the one the panel draws until the live reader is wired in,
 * under a "Sample numbers" banner. Every figure is a round number and every name says `sample`, so
 * no screenshot of it can pass for this box's ledger: $50.00 of balance, $2.00 today, $12.00 over
 * seven days, consumers and outings at whole tenths of a dollar.
 *
 * Built relative to the moment it is asked for, so "today", "ago" and the hour bars read as they
 * will with live data; the numbers themselves never move.
 */

const HOUR = 3_600;
const DAY = 86_400;

/** Local midnight, `n` days back, in epoch seconds — the reader's own day boundary. */
function midnight(now: number, daysBack: number): number {
  const d = new Date(now * 1000);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime() / 1000;
}

function dayKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Fourteen local days, oldest first, a quiet zero day among them so the stub is on screen. */
function sampleDays(now: number): DeepseekDay[] {
  const usd = [1, 0.5, 0, 1.5, 2, 1, 0.5, 1, 3, 2, 1, 0.5, 1.5, 2];
  return usd.map((value, i) => ({
    day: dayKey(midnight(now, 13 - i)),
    outings: value * 4,
    tokens: value * 1_000_000,
    usd: value,
    usd_list: value * 1.5,
  }));
}

type OutingSeed = [kind: DeepseekKind, name: string, soul: string | null, role: string, model: string, usd: number, agoS: number, parent?: string];

const SEEDS: OutingSeed[] = [
  ['run', 'sample-plan', 'hephaestus', 'builder', 'deepseek-v4-pro', 0.5, 300],
  ['run', 'sample-plan', 'athena', 'athena', 'deepseek-v4-pro', 0.5, 1_200],
  ['run', 'sample-plan', 'athena', 'subagent', 'deepseek-flash', 0.1, 1_500, 'sample-session-a'],
  ['chain', 'sample-chain', 'hephaestus', 'builder', 'deepseek-v4-pro', 0.3, 2_400],
  ['heal', 'heal-sample-20260101-000000', 'asclepius', 'heal', 'deepseek-flash', 0.2, 3_600],
  ['wave', 'sample-wave', 'scout', 'scout', 'deepseek-flash', 0.1, 5_400],
  ['session', 'sample-project', null, 'chat', 'deepseek-flash', 0.2, 7_200],
  ['soul', 'dispatch-sample-20260101-000000-abcd', 'iris', 'builder', 'deepseek-v4-pro', 0.1, 9_000],
];

function sampleOuting(seed: OutingSeed, i: number, now: number): DeepseekOuting {
  const [kind, name, soul, role, model, usd, agoS, parent] = seed;
  const input = usd * 400_000;
  const output = usd * 100_000;
  const cacheRead = usd * 500_000;
  return {
    outing: `sample-${i}#1`, session_id: `sample-${i}`, segment: 1,
    started_at: now - agoS - 600, last_at: now - agoS,
    parent_session: parent ?? null, soul, role, model, kind, name,
    run_id: kind === 'run' ? 'sample-plan-20260101-000000-abcd' : null,
    input, output, cache_read: cacheRead, cache_write: 0,
    tokens: input + output + cacheRead, usd, usd_list: usd * 1.5,
  };
}

/** A day of hours: most covered, two without a balance pair, one top-up. */
function sampleHours(now: number): DeepseekReconHour[] {
  const start = Math.floor(now / HOUR) * HOUR - 11 * HOUR;
  const ledger = [0.1, 0.2, 0, 0.3, 0.1, 0.2, 0.2, 0, 0.1, 0.3, 0.2, 0.1];
  return ledger.map((value, i) => ({
    hour_start: start + i * HOUR,
    ledger_usd: value,
    balance_usd: i === 2 || i === 7 ? null : value + (i === 4 ? 0.1 : 0),
    topup_usd: i === 6 ? 10 : 0,
    readings: i === 2 || i === 7 ? 0 : 20,
  }));
}

export function sampleUsage(range: DeepseekRange, now: number = Date.now() / 1000): DeepseekUsageSummary {
  const outings = SEEDS.map((seed, i) => sampleOuting(seed, i, now));
  const usdTotal = 2;
  return {
    generated_at: now,
    ledger: { path: '~/.claude/state/deepseek_usage/ledger.sqlite', present: true, messages: 400, outings: 80, first_ts: now - 30 * DAY, last_ts: now - 300, synced_at: now - 10, sync_s: 0.5, unpriced_models: [] },
    pricing: { mode: 'per-row', off_peak_factor: 0.5, peak_utc: [[1, 4], [6, 10]], weekdays_only: true, holidays_modelled: false, rates: { 'deepseek-flash': [0.3, 1.2, 0.03, 0.3, 0.3] } },
    endpoint: 'https://sample-endpoint.invalid/anthropic',
    balance: { total: 50, currency: 'USD', available: true, checked_at: now - 120 },
    spend: {
      today_usd: 2, week_usd: 12, all_usd: 40, today_list_usd: 3, week_list_usd: 18, all_list_usd: 60,
      today_outings: 8, week_outings: 48, all_outings: 160, today_balance_usd: 2, week_balance_usd: 12,
    },
    days: sampleDays(now),
    range,
    range_since: range === 'all' ? null : midnight(now, { today: 0, '7d': 6, '30d': 29 }[range]),
    totals: { outings: 8, messages: 40, input: 800_000, output: 200_000, cache_read: 1_000_000, cache_write: 0, tokens: 2_000_000, usd: usdTotal, usd_list: 3 },
    columns: {
      input: { tokens: 800_000, usd: 1 }, output: { tokens: 200_000, usd: 0.5 },
      cache_read: { tokens: 1_000_000, usd: 0.5 }, cache_write: { tokens: 0, usd: 0 },
    },
    kinds: [
      { key: 'run', outings: 3, usd: 1.1, share: 0.55 }, { key: 'chain', outings: 1, usd: 0.3, share: 0.15 },
      { key: 'heal', outings: 1, usd: 0.2, share: 0.1 }, { key: 'session', outings: 1, usd: 0.2, share: 0.1 },
      { key: 'wave', outings: 1, usd: 0.1, share: 0.05 }, { key: 'soul', outings: 1, usd: 0.1, share: 0.05 },
    ],
    roles: [
      { key: 'builder', outings: 3, usd: 0.9, share: 0.45 }, { key: 'athena', outings: 1, usd: 0.5, share: 0.25 },
      { key: 'heal', outings: 1, usd: 0.2, share: 0.1 }, { key: 'chat', outings: 1, usd: 0.2, share: 0.1 },
      { key: 'subagent', outings: 1, usd: 0.1, share: 0.05 }, { key: 'scout', outings: 1, usd: 0.1, share: 0.05 },
    ],
    models: [
      { key: 'deepseek-v4-pro', outings: 4, usd: 1.4, share: 0.7 }, { key: 'deepseek-flash', outings: 4, usd: 0.6, share: 0.3 },
    ],
    souls: [
      { key: 'hephaestus', outings: 2, usd: 0.8, share: 0.4 }, { key: 'athena', outings: 2, usd: 0.6, share: 0.3 },
      { key: 'asclepius', outings: 1, usd: 0.2, share: 0.1 }, { key: '(unknown)', outings: 1, usd: 0.2, share: 0.1 },
      { key: 'scout', outings: 1, usd: 0.1, share: 0.05 }, { key: 'iris', outings: 1, usd: 0.1, share: 0.05 },
    ],
    consumers: [
      { kind: 'run', name: 'sample-plan', outings: 3, input: 440_000, output: 110_000, cache_read: 550_000, cache_write: 0, tokens: 1_100_000, usd: 1.1, usd_list: 1.65, share: 0.55, last_ts: now - 300 },
      { kind: 'chain', name: 'sample-chain', outings: 1, input: 120_000, output: 30_000, cache_read: 150_000, cache_write: 0, tokens: 300_000, usd: 0.3, usd_list: 0.45, share: 0.15, last_ts: now - 2_400 },
      { kind: 'heal', name: 'heal-sample-20260101-000000', outings: 1, input: 80_000, output: 20_000, cache_read: 100_000, cache_write: 0, tokens: 200_000, usd: 0.2, usd_list: 0.3, share: 0.1, last_ts: now - 3_600 },
      { kind: 'session', name: 'sample-project', outings: 1, input: 80_000, output: 20_000, cache_read: 100_000, cache_write: 0, tokens: 200_000, usd: 0.2, usd_list: 0.3, share: 0.1, last_ts: now - 7_200 },
      { kind: 'wave', name: 'sample-wave', outings: 1, input: 40_000, output: 10_000, cache_read: 50_000, cache_write: 0, tokens: 100_000, usd: 0.1, usd_list: 0.15, share: 0.05, last_ts: now - 5_400 },
      { kind: 'soul', name: 'dispatch-sample-20260101-000000-abcd', outings: 1, input: 40_000, output: 10_000, cache_read: 50_000, cache_write: 0, tokens: 100_000, usd: 0.1, usd_list: 0.15, share: 0.05, last_ts: now - 9_000 },
    ],
    top: { kind: 'run', name: 'sample-plan', usd: 1.1, share: 0.55 },
    outings: [...outings].sort((a, b) => b.usd - a.usd),
    feed: [...outings].sort((a, b) => b.last_at - a.last_at),
    recon: {
      currency: 'USD', readings: 200, covered_hours: 10, ledger_usd: 1.8, balance_usd: 1.9,
      gap_usd: 0.1, topups_usd: 10, unassigned_usd: 0, hours: sampleHours(now),
    },
  };
}
