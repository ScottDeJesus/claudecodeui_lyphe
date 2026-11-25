/**
 * CloudCLI's own Gemini meter: its two tables, as one idempotent DDL script.
 *
 * gemini_calls_daily counts every request this server makes to Google, one row per account, UTC day, feature, model
 * and key: the calls, the failures, the calls whose answer carried Google's own usage (metered_calls) and the tokens.
 * No dollars are stored: the meter prices at read (gemini-meter/gemini-rates.ts), so a corrected price corrects every
 * day it covers. The key itself is never stored: key_id is the first 8 hex of its sha256, key_tail its last four
 * characters. feature carries no CHECK on purpose: the closed set lives in GeminiFeature at the door, so a fourth
 * feature is a code change and never a table rebuild.
 *
 * gemini_feature_switches holds an account's switch per feature; no row means on.
 *
 * Both hang on users with ON DELETE CASCADE: a removed account takes its count and its switches with it.
 *
 * The only consumer is runMigrations, which execs this beside FOLLOWUPS_SCHEMA_SQL (after NOTES_SCHEMA_SQL). Every
 * statement is IF NOT EXISTS, so a re-run is a no-op, and the trap the notes script names holds here too: a later
 * column needs an explicit ALTER TABLE through addColumnToTableIfNotExists in migrations.ts, never an edit below.
 */
export const GEMINI_METER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS gemini_calls_daily (
    user_id INTEGER NOT NULL,
    -- The UTC date of the call, YYYY-MM-DD.
    usage_date TEXT NOT NULL,
    feature TEXT NOT NULL,
    model TEXT NOT NULL,
    key_id TEXT NOT NULL,
    key_tail TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    metered_calls INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    input_audio_tokens INTEGER NOT NULL DEFAULT 0,
    output_audio_tokens INTEGER NOT NULL DEFAULT 0,
    -- ISO-8601 UTC with milliseconds: the row's first and latest call.
    first_at TEXT NOT NULL,
    last_at TEXT NOT NULL,
    PRIMARY KEY (user_id, usage_date, feature, model, key_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gemini_feature_switches (
    user_id INTEGER NOT NULL,
    feature TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, feature),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;
