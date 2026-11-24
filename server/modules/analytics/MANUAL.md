<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-10102 — server/modules/analytics — the Analytics area at /api/analytics: the reader table, CODE_MODE_BIN, the faults, and how a section adds its reader

`server/modules/analytics/` is the Analytics area's server half, mounted by `server/index.ts` as
`app.use('/api/analytics', authenticateToken, analytics.router)` and built inline the way heal is (no timer,
no socket). It follows the house shape of MAN-479 — composition root, router factory, service — and holds no
numbers of its own: each section's reader asks the module or verb that owns them.

| File | What it holds |
|---|---|
| `analytics.module.ts` · `index.ts` | `createAnalyticsModule(): { router }`. Reads `CODE_MODE_BIN` (default `~/.claude/scripts/code-mode`) , `WEB_WALK_BIN` (default `~/.claude/scripts/web-walk`) and `HEAL_REPEATS_BIN` (default `~/.claude/scripts/heal-repeats`), `~` expanded, here and nowhere below, and hands them to the reader table. |
| `analytics.routes.ts` | `GET /` → `AnalyticsSectionList` (`{ sections: [{ id }] }`); `GET /:section?days=N` → `AnalyticsAnswer` (`{ section, days, data }`). One service call each, anything thrown handed to `next`; the route judges nothing. |
| `analytics.service.ts` | `list()` and `read(sectionInput, daysInput)`, with every judgement: an id no reader holds (own keys only) is a 404 `ANALYTICS_SECTION_UNKNOWN`; `days` absent is 30; `days` that is not 1–3 digits from 1 to 366 is a 400 `ANALYTICS_DAYS_INVALID`; a reader that threw is a 502 `ANALYTICS_SOURCE_FAILED` carrying the reader's sentence, logged as `[analytics] the <id> section could not be read for <days> days: …`. Errors are `AppError`s, rendered by the global handler as `{ success: false, error: { code, message } }`. |
| `sections/index.ts` | `createAnalyticsReaders({ codeModeBin, webWalkBin, healRepeatsBin })` → `Record<id, (days) => Promise<unknown>>`, the reader table. Three rows: `'code-mode'`, `'web-walk'` and `'repeats'`. |
| `sections/repeats.ts` | `createRepeatsReader(bin)`: `heal-repeats reading --days N` (hooks/heal_repeats/answer.py) through `verb.ts` → `RepeatsAnalytics`. Builds `thresholds`, `totals` and `steps` key by key, carries the rows of `series`, `families` and `steps.by_helper` as printed, computes nothing; a key of the wrong type is a sentence. The client half is `src/modules/analytics/sections/repeats/` (MAN-10134). |
| `sections/verb.ts` | `runVerbForJson(bin, args, words)`: the one runner of a house verb for every section. Runs it under `userFacingEnv()`, cwd the home folder, 30 s timeout, 16 MiB `maxBuffer`; parses the LAST stdout line. Its failures are sentences worded by `words` (`{ verb, command }`): the verb missing, the verb not runnable (the spawn errno named, e.g. EACCES), past 30 s, past 16 MiB, its stderr's last line, no JSON on the last line. |
| `sections/web-walk.ts` | `createWebWalkReader(bin)`: `web-walk reading --days N` (hooks/web_walk/answer.py) through `verb.ts` → `WebWalkAnalytics`. Builds `settled` (with `bars`), `totals`, `doors` and `autocorrect` (`autocorrectOf`: its `corrected` and `refused` lists) key by key, carries the rows of `series`, `checks`, `apps` and Autocorrect's two lists as printed, computes nothing; a key of the wrong type is a sentence. |
| `sections/code-mode.ts` | Runs `code-mode analytics --days N` through `verb.ts`; checks each top-level key's type and carries the rows as printed. It holds no list of kinds and computes nothing. A key of the wrong type is a sentence; the run's own failures are `verb.ts`'s. |

The wire shapes live in `server/shared/analytics-types.ts` and its field-for-field client mirror
`src/shared/analytics-types.ts` (both listed in `.oxlintrc.json` beside `app-types.ts`): the envelope
`AnalyticsSectionList` / `AnalyticsAnswer<T>`, `RepeatsAnalytics` (rows `RepeatsDay`, `RepeatsFamily`, `RepeatsFamilyDay`, `RepeatsExisting`, `RepeatsStepHelper`; read by `sections/repeats.ts`), `WebWalkAnalytics` (`days`, `generated_at`, `today`, `first_day`, `settled: WebWalkSettled` with `bars: WebWalkBars`, `totals: WebWalkTotals`, `series: WebWalkDay[]`, `checks: WebWalkCheck[]`, `doors: WebWalkDoors`, `apps: WebWalkApp[]` with `WebWalkScreen`, `autocorrect: WebWalkAutocorrect` = `{ corrected: WebWalkAutocorrected[] ({ entry, steps }), refused: WebWalkUncorrected[] ({ refusal, walks }) }`; snake_case as the helper prints; read by `sections/web-walk.ts`), and `CodeModeAnalytics` with its rows `CodeModeFigures`,
`CodeModeGroup`, `CodeModeDay`, `CodeModeCause`, `CodeModeKind` — key for key as the verb prints them
(`CodeModeFigures` ends `failed`, `declined`, `resent`, `saves_skipped`: automatic saves the house refused)
(snake_case kept; "all" is null, never ""), and `faults` as `CodeModeFaultTotals` = `{ total, by_fault: { <fault>: count } }`.

**Adding a section (server half).** (1) Write `sections/<id>.ts`: a reader `(days) => Promise<data>` that calls
the owning module's door (its service or its verb) and throws one sentence on failure; anything the reader needs
from the environment is read in `analytics.module.ts` and passed through `createAnalyticsReaders`'s argument.
(2) Add its row to the table in `sections/index.ts` under the id the client registry will use. (3) Put the
answer's type in BOTH `analytics-types.ts` files. The service and the routes need no change: `GET /` lists the
new id and `GET /<id>` reads it. The client half (registry row, `Body`, words) is the client module's.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/analytics.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/analytics.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/analytics.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/sections/code-mode.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/sections/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/sections/repeats.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/sections/verb.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/analytics/sections/web-walk.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/analytics-types.ts, /home/lyphe/.claude/claudecodeui_lyphe/src/shared/analytics-types.ts
