<!-- docstore export; edit rows with docstore write, never this file -->

## INV-7004 — Cerberus store — edits that break it

Behaviour of each: MAN-7805 (connection, steps), MAN-7806 (repositories).

| Edit | Breaks | Why |
|---|---|---|
| Edit, reorder or remove a step in `CERBERUS_MIGRATIONS` that has run on the live store | the live store keeps the old shape while every scratch file builds the new one | position is the version; a change is a new step appended |
| Run a step in a deferred transaction, or read `user_version` outside `BEGIN IMMEDIATE` | the overlapping process of a handover fails on its first `CREATE TABLE` | measured 2026-10-06: 6 processes, 4 rounds — deferred failed 20 of 24 with `database is locked`, `.immediate()` opened 24 of 24 |
| Replace the two `CROSS JOIN`s in `rowsInWindow` with plain `JOIN` | a window read walks every row of the node | no `ANALYZE` ever runs on this store, so the planner drives from `results` on `node` alone: 200 ms a part against 0.1 ms pinned, 466k rows |
| Turn `results.insert`'s `ON CONFLICT … DO NOTHING` into `INSERT OR IGNORE` | a malformed row answers `false` exactly as a resend does, so a lost row is acked as a duplicate | a `false` is a resend, which the caller acks |
| Change `transitions`' whole-instant return or the activity cursor (`before = last.at`, strict `<`) without the other | rows sharing one `at` are skipped at a page boundary | a health document stamps every component with one `at` |
| Pass an unclamped `limit` to SQL | `LIMIT -1` dumps the table | SQLite reads a negative limit as no limit |
| Let a new `results.at` be a string or fraction | that row is the check's latest for ever | TEXT sorts above every number; the column's affinity cannot refuse it |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-connection.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/cerberus-schema.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-mutes.db.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/database/repositories/cerberus-results.db.ts
