<!-- docstore export; edit rows with docstore write, never this file -->

## INV-9509 — A FIFO at a flag path hangs readFlagText — every heal flag and the Gemini plan cap GET

`readFlagText` (`server/modules/settings/heal-switch.ts`) does `stat` then `readFile`, a BLOCKING open. A FIFO at the path passes the size check (0 bytes) and the open waits for a writer that never comes: the read never answers.

| reads through `readFlagText` | hangs on a FIFO |
|---|---|
| `heal.flag`, `heal_daily_cap.flag`, `heal_model.flag`, `heal_cycle.flag` (MAN-630) | yes |
| the Gemini cap file (`GET /api/settings/gemini-plan-cap`, and the read-back of its PUT; MAN-8963) | yes |

The Python twin does not: `ledger.cap_usd()` opens `O_NONBLOCK` and reads a FIFO as empty → `5.0` (MAN-8959). The two cap readers agree on every byte shape measured and differ on this one.

Measured 2026-10-22 (Athena's probe, Gemini cap phase): FIFO at `GEMINI_PLAN_CAP_FILE` → JS reader `no answer in 6s`. Cured prints `js: 5`.

| when | do |
|---|---|
| curing | `O_NONBLOCK` open inside `readFlagText` itself: one change covers all five files, and is shared code that needs its own review |
| tempted to guard in `gemini-plan-cap.ts` alone | don't: the four heal files stay live, and the guard is dead code once `readFlagText` is cured |
| writing a new reader of a flag file | go through `readFlagText`; do not add a second `readFile` of a flag path |

Not cured as of 2026-10-22. Reached only by a FIFO made by hand at the path; `writeFlag` writes regular files.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/gemini-plan-cap.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/heal-switch.ts
