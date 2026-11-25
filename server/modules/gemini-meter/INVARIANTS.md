<!-- docstore export; edit rows with docstore write, never this file -->

## INV-11942 — server/modules/gemini-meter — the meter never throws, stores no dollars and no key, reads a switch at the ask, and imports no voice code

Rules for CloudCLI's own Gemini meter, `server/modules/gemini-meter/` (manual: this package's summary row).

| rule | why |
|---|---|
| `recordGeminiCall` never throws and never blocks: one upsert inside one try; a failed write is one `console.warn` naming the account, feature, model and the error's CLASS, never its message | a meter fault must never take a voice call down with it, and a SQLite message can quote the statement's values |
| No dollars are stored. Price at read with `costOf`; a call whose answer carried no usage of Google's own raises `calls` and not `metered_calls`, and `metered_calls` counts answered calls only (a failed call never adds to it, so `unmeasured_calls` = calls − failures − metered_calls); a model no rate covers is named in `unpriced_models` and adds no dollars | absence of measurement is never recorded as zero cost, and a corrected price corrects every day it covers |
| A price change is a NEW dated row in `GEMINI_RATES`, never an edit of an old one, and its figures follow the house table (`core/llm_pricing.py`) | a past day keeps the price it was spent at, and CloudCLI's estimate agrees with the connector's |
| The key is never stored, logged or answered: `key_id` (8 hex of sha256, `geminiKeyId` in `gemini-key.ts`) and `key_tail` (last four) only | a key in a table or a body is a leaked key (INV-9908) |
| A switch is read at the moment of the ask (`geminiFeatureOff`), no row means on, nothing caches it, and a read that fails answers false (on) with one `console.warn` naming the error's class | the PUT takes effect on the very next ask, with no clock |
| Every statement names the account it acts for, and both doors read `readAuthenticatedUserId` | nothing reads or writes across accounts |
| This module imports no voice code at runtime; the held keys come in through `createGeminiMeterModule({ heldKeysOf })` | the voice wire imports this barrel; an import back is a cycle |
| `feature` carries no CHECK in the table; the closed set is `GeminiFeature`, checked at the door | a fourth feature is a code change, never a SQLite table rebuild |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/gemini-meter-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/gemini-meter.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/gemini-meter.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/gemini-meter.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/gemini-meter.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/gemini-rates.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/gemini-meter/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/voice/gemini-key.ts
