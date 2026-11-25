<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-10223 — server/modules/gemini-meter — CloudCLI's own Gemini meter: its two tables, the record and switch functions, the dated prices and /api/gemini-meter

`server/modules/gemini-meter/` is CloudCLI's own Gemini meter: the count of every request this server makes to Google, per account, UTC day, feature, model and key; the account's switch per feature; and the window's reading, served in the same snake_case row shape the connector's `/api/gemini-usage` door serves, so one row component draws both. `server/index.ts` builds it with `createGeminiMeterModule({ heldKeysOf: heldGeminiKeys })` and mounts the router at `/api/gemini-meter` behind `authenticateToken`. Rules: the INV row of this package.

## Barrel — `index.ts`
| export | consumer |
|---|---|
| `createGeminiMeterModule` | `server/index.ts` |
| `recordGeminiCall(userId, call)` | the voice module's wire (`askGemini`, `voice/gemini-wire.ts`, MAN-10228): one upsert per request, never throws; a failed write is one `console.warn` naming the account, feature, model and the error's class |
| `geminiFeatureOff(userId, feature)` | the voice module's wire, before it sends: read at call time, false with no row; a failed read answers false (on) with one `console.warn` naming the account, feature and the error's class, and never throws |
| `geminiFeatureLabel(feature)` | the voice wire's off sentence (`Gemini is switched off for <label>: …`), in the same words the usage reading lists |
| `rateFor(model, usageDate)` | the voice wire's usage reading (`gemini-usage-read.ts`): `audioOutTokensPerSecond`, to derive a speech answer's output when Google sent no usage |
| types `GeminiFeature` (`companion_speech` \| `read_aloud` \| `backup_transcription`), `GeminiUsage`, `HeldGeminiKey` | the voice module (`gemini-key.ts`'s `heldGeminiKeys`, the wire) |

## The tables — `database/gemini-meter-schema.ts` (`GEMINI_METER_SCHEMA_SQL`, exec'd by `runMigrations` right after `FOLLOWUPS_SCHEMA_SQL`)
- `gemini_calls_daily(user_id, usage_date, feature, model, key_id, key_tail, calls, failures, metered_calls, input_tokens, output_tokens, input_audio_tokens, output_audio_tokens, first_at, last_at)`, PK `(user_id, usage_date, feature, model, key_id)`. `usage_date` is a UTC date; `key_id` the first 8 hex of the key's sha256, `key_tail` its last four characters; the key itself is stored nowhere. Token counts are totals; the audio columns are the audio part of each. No dollars.
- `gemini_feature_switches(user_id, feature, enabled 0|1, updated_at)`, PK `(user_id, feature)`. No row means on.
- Both `REFERENCES users(id) ON DELETE CASCADE`. `feature` has no CHECK: the closed set is `GeminiFeature`, checked at the door, so a fourth feature is never a table rebuild.
- Repository: `database/repositories/gemini-meter.db.ts`, `geminiMeterDb` (`addCall`, `rowsBetween`, `readSwitch`, `listSwitches`, `writeSwitch`), reached through `@/modules/database/index.js` by this module alone.

## Prices — `gemini-rates.ts`
`GEMINI_RATES`: dated rows `{ model, from, textInPerM, audioInPerM, textOutPerM, audioOutPerM, audioOutTokensPerSecond }` for `gemini-3.8-flash`, `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`, the figures of the house table (`/opt/shadow-connector/core/llm_pricing.py`, `_RATES` and `_CHANGES`: all three double on 2027-01-01). A model matches the longest family prefix. `rateFor(model, usageDate)`; `costOf(row)` is dollars or null when no rate covers the model on its day. A new price is a new dated row.

## The doors — `gemini-meter.routes.ts` (bare JSON, the signed-in account only)
- `GET /usage?range=today|7d|30d` → `{ range, from, to, cost_basis, project: "cloudcli", cost_usd, calls, features, days: [{date, cost_usd}], keys, unpriced_models }`. `features` is always the three rows `{ feature, label, enabled, calls, failures, unmeasured_calls, input_tokens, output_tokens, cost_usd, models, last_at }`; `unmeasured_calls` = answered calls whose answer carried no usage of Google's own (calls − failures − metered_calls). `keys` is every key the window counted and every key the account holds now (`heldGeminiKeys`: its stored key `account`, the house's `house`), `{ key: last four, held_as: [...], calls, cost_usd }`, most calls first. `cost_usd` is 0 for no rows, null when rows exist and no model of theirs has a rate, else the priced rows' sum to a millionth; an unpriced model is named in `unpriced_models` and adds no dollars. Any other range: 400 `RANGE_INVALID`.
- `PUT /switches/:feature` body `{"enabled": boolean}` → `{ feature, enabled }` as the table reads back. 400 `FEATURE_INVALID` for a feature outside the three, 400 `ENABLED_INVALID` for a non-boolean.

## Why the held keys are handed in
The voice module's wire imports this barrel, so this module imports no voice code at runtime: `gemini-key.ts` exports `heldGeminiKeys(userId)` (digest and tail only; `geminiKeyId` is the one digest rule) through the voice barrel, and `server/index.ts` passes it in.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/gemini-meter-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/gemini-meter.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/gemini-meter.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/gemini-meter.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/gemini-meter.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/gemini-rates.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/index.ts
