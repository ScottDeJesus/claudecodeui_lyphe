<!-- docstore export; edit rows with docstore write, never this file -->

## INV-9509 — readFlagText opens O_NONBLOCK and trusts a regular file only — a FIFO at a flag path reads as null, never as a hang (every heal flag and the Gemini plan cap GET)

`readFlagText` (`server/modules/settings/heal-switch.ts`) opens its path `O_NONBLOCK`, takes the descriptor's own `fstat`, and answers `null` ("not this reader's to trust") for anything that is not a regular file or is past the byte bound. A FIFO left at a flag path therefore answers at once. A blocking open would wait for a writer that never comes, and the read would never answer.

| reads through `readFlagText` | a FIFO there reads |
|---|---|
| `heal.flag`, `heal_daily_cap.flag`, `heal_model.flag`, `heal_cycle.flag` (MAN-630) | `null`: each caller's default (the master ON, no ceiling, ...) |
| the Gemini cap file (`GET /api/settings/gemini-plan-cap`, and the read-back of its PUT; MAN-8963) | `null`: the default cap, `5` |

The Python twin agrees: `ledger.cap_usd()` opens `O_NONBLOCK` and reads a FIFO as empty, `5.0` (MAN-8959).

Measured 2026-10-24: FIFO at the flag path, HEAD copy of `heal-switch.ts` `no answer in 5s`; the edited copy `null`. Regular files, a BOM, an empty file, a directory, a symlink to a regular file, an absent path and a file past `FLAG_MAX_BYTES` read exactly as before.

| when | do |
|---|---|
| writing a new reader of a flag file | go through `readFlagText`; do not add a second `readFile` of a flag path |
| tempted to guard one flag family alone | don't: the one open in `readFlagText` covers all five files |

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/gemini-plan-cap.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/heal-switch.ts
