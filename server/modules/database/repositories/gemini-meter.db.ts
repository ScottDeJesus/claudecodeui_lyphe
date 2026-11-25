import { getConnection } from '@/modules/database/connection.js';

/**
 * gemini_calls_daily and gemini_feature_switches, as row-level statements: CloudCLI's own Gemini meter.
 *
 * Every statement names the account it acts for, so no read or write crosses accounts. A call is counted by ONE
 * upsert onto its (account, day, feature, model, key) row; nothing here rewrites a day. Feature names are plain
 * strings at this layer: the closed set is the module's (GeminiFeature, gemini-meter.service.ts).
 *
 * Consumer: server/modules/gemini-meter/gemini-meter.service.ts, the meter's only reader and writer. Reach it
 * through @/modules/database/index.js.
 */

/** One gemini_calls_daily row, exactly as the table stores it. */
export type GeminiCallsDailyRow = {
  user_id: number;
  usage_date: string;
  feature: string;
  model: string;
  key_id: string;
  key_tail: string;
  calls: number;
  failures: number;
  metered_calls: number;
  input_tokens: number;
  output_tokens: number;
  input_audio_tokens: number;
  output_audio_tokens: number;
  first_at: string;
  last_at: string;
};

/** One call to add to its day's row. */
export type GeminiCallCount = {
  userId: number;
  usageDate: string;
  feature: string;
  model: string;
  keyId: string;
  keyTail: string;
  failed: boolean;
  metered: boolean;
  inputTokens: number;
  outputTokens: number;
  inputAudioTokens: number;
  outputAudioTokens: number;
  at: string;
};

const CALL_COLUMNS =
  'user_id, usage_date, feature, model, key_id, key_tail, calls, failures, metered_calls, input_tokens, output_tokens, ' +
  'input_audio_tokens, output_audio_tokens, first_at, last_at';

export const geminiMeterDb = {
  /** Adds one call to its day's row, creating the row on the day's first call. */
  addCall(count: GeminiCallCount): void {
    getConnection()
      .prepare(
        'INSERT INTO gemini_calls_daily (' + CALL_COLUMNS + ') VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT (user_id, usage_date, feature, model, key_id) DO UPDATE SET ' +
          'key_tail = excluded.key_tail, ' +
          'calls = gemini_calls_daily.calls + 1, ' +
          'failures = gemini_calls_daily.failures + excluded.failures, ' +
          'metered_calls = gemini_calls_daily.metered_calls + excluded.metered_calls, ' +
          'input_tokens = gemini_calls_daily.input_tokens + excluded.input_tokens, ' +
          'output_tokens = gemini_calls_daily.output_tokens + excluded.output_tokens, ' +
          'input_audio_tokens = gemini_calls_daily.input_audio_tokens + excluded.input_audio_tokens, ' +
          'output_audio_tokens = gemini_calls_daily.output_audio_tokens + excluded.output_audio_tokens, ' +
          'last_at = excluded.last_at'
      )
      .run(
        count.userId,
        count.usageDate,
        count.feature,
        count.model,
        count.keyId,
        count.keyTail,
        count.failed ? 1 : 0,
        count.metered ? 1 : 0,
        count.inputTokens,
        count.outputTokens,
        count.inputAudioTokens,
        count.outputAudioTokens,
        count.at,
        count.at
      );
  },

  /** One account's rows from fromDate to toDate inclusive (UTC dates), oldest day first. */
  rowsBetween(userId: number, fromDate: string, toDate: string): GeminiCallsDailyRow[] {
    return getConnection()
      .prepare(
        'SELECT ' + CALL_COLUMNS + ' FROM gemini_calls_daily WHERE user_id = ? AND usage_date BETWEEN ? AND ? ' +
          'ORDER BY usage_date, feature, model, key_id'
      )
      .all(userId, fromDate, toDate) as GeminiCallsDailyRow[];
  },

  /** The account's stored switch for a feature, or null when it never set one. */
  readSwitch(userId: number, feature: string): boolean | null {
    const row = getConnection()
      .prepare('SELECT enabled FROM gemini_feature_switches WHERE user_id = ? AND feature = ?')
      .get(userId, feature) as { enabled: number } | undefined;
    return row ? row.enabled === 1 : null;
  },

  /** Every switch the account has set, by feature. */
  listSwitches(userId: number): Map<string, boolean> {
    const rows = getConnection()
      .prepare('SELECT feature, enabled FROM gemini_feature_switches WHERE user_id = ?')
      .all(userId) as { feature: string; enabled: number }[];
    return new Map(rows.map((row) => [row.feature, row.enabled === 1]));
  },

  /** Sets one switch; a second write of the same state only moves updated_at. */
  writeSwitch(userId: number, feature: string, enabled: boolean, at: string): void {
    getConnection()
      .prepare(
        'INSERT INTO gemini_feature_switches (user_id, feature, enabled, updated_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT (user_id, feature) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at'
      )
      .run(userId, feature, enabled ? 1 : 0, at);
  },
};
