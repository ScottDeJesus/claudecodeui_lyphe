<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-8702 — settings

The `/api/settings` module: thin transport in `settings.routes.ts` over `settings.service.ts`, and beside them one small file per host-wide switch — a flag file read and written whole (the two DeepSeek switches, park-at-peak, planner lanes, the pacer's weekly stop, Dactyls, Custom compaction, main-session Dactyls, the heal reflex's four and JEV) — plus `dispatcher-kick.ts`, the one kick every switch write ends with (MAN-1497), and `claude-api-keys.ts`, the Claude API keys' relay over the `claude-api` door (MAN-8701), and `gemini-plan-cap.ts`, the Gemini budget's cap file — one dollar amount, no off state (MAN-8963). `settings.module.ts` wires the router, and `index.ts` is the barrel other modules reach it through.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/

## MAN-8701 — The Claude API keys routes — GET, PUT and DELETE /api/settings/claude-api, a key only ever on the door’s stdin

The three Settings routes that relay the Claude API keys' door — `GET`, `PUT` and `DELETE /api/settings/claude-api[/:slot]` — and the one module that speaks to `~/.claude/scripts/claude-api` (MAN-8625). The routes live in `settings.routes.ts` beside the host-wide switches; the bodies live in `claude-api-keys.ts`; `settings.service.ts` gains nothing (it is over its ceiling and takes call-in lines only).

**The door.** `CLAUDE_API_BIN` moves it for a probe; the default is `~/.claude/scripts/claude-api`, expanded with `expandHome` exactly as `dispatcher-kick.ts` resolves `DISPATCHER_BIN`. The child inherits this server's environment, so the scratch seams (`PLAN_RUNNER_CLAUDE_API_KEYS`, `PLAN_RUNNER_CLAUDE_API_HOME`, `DISPATCHER_HOME`) reach the same store the plan runner itself reads.

**The routes** — host-wide, and no `userId` is read: they steer the keys of one runner on this host, not a row anyone owns.

| route | answer |
| --- | --- |
| `GET /api/settings/claude-api` | the door's picture (`status --json`) relayed whole, or `{unreadable:true}` on any read failure |
| `PUT /api/settings/claude-api/:slot` | a fresh picture after SAVED; 422 `CLAUDE_API_KEY_REFUSED` with the door's own words; 502 `CLAUDE_API_DOOR_FAILED` with the door's one stderr line |
| `DELETE /api/settings/claude-api/:slot` | a fresh picture after REMOVED |

`unreadable` is never "not set": the card draws "unknown" and offers its retry (INV-8936), because a store this server could not see is not an empty one.

**The 400s, before any door is spawned** — a slot that is not `1` or `2` (`INVALID_CLAUDE_API_SLOT`), a `key` that is not a string (`INVALID_CLAUDE_API_KEY`), a `label` that is not a string (`INVALID_CLAUDE_API_LABEL`), a `creditUsd` that is not a finite non-negative number (`INVALID_CLAUDE_API_CREDIT`), and a `renewsDay` that is not a whole 1–31 or `null` (`INVALID_CLAUDE_API_RENEWS_DAY`). Everything that is a RULE stays in Python: the key's `sk-ant-api…` shape, the admin and OAuth refusals, a label shaped like a key, and settings for an empty slot. The door answers those with exit 2 and its own sentence, `REFUSED key <n>: <rule>`, which the route relays as the 422's `message` with the protocol word stripped.

**The write contract.** `set <slot>`; `--key-stdin` and the key written to the child's stdin exactly when the body carries one; `--label`, `--credit` and `--renews` when the body does. `renewsDay: null` is spelled `--renews none`; an omitted field is left out, so the slot keeps its stored value. DELETE runs `remove <slot>`. Both answer a fresh read, never an echo of the body. A door failure past the write (a save whose wall could not be lifted is `WallsStand`) is exit 1 and a 502 by class, never a SAVED.

**The key.** It is in the request body, on the child's stdin, and nowhere else: not argv, not the environment, not a log, not an error, not an answer. This module logs nothing at all; the body is never echoed in an error; and EVERY string it relays — the whole picture, a refusal, an error — passes a key-shaped redaction (`sk-ant-…` → `[key]`) as a second seam, so a stand-in door that echoed its stdin still puts no key in an answer.

**The kick.** A SAVED or REMOVED write ends in `void kickDispatcher()` (MAN-1497 §"THE KICK"): a save clears that payer's walls, and the dispatcher's release asks whether another payer now carries the plan (`account_release.py`). A FAILED write kicks too: the door writes the slot and key before it lifts their walls, so a failed lift (`WallsStand`, exit 1) has already landed the save and may have freed a plan. Only a REFUSED answer — which wrote nothing — kicks nothing.

**Shown by** (a scratch store, never the live one): `. scripts/apps-probe-env.sh; D=$(mktemp -d); PLAN_RUNNER_CLAUDE_API_KEYS=$D/keys.json PLAN_RUNNER_CLAUDE_API_HOME=$D/home DISPATCHER_HOME=$D/state/dispatcher boot_probe_server`, then with `mint_token`: GET both slots unset; PUT slot 1 with a made-up `sk-ant-api03…` key, a label and a renewal day → 200, slot 1 set, no key in the body; PUT slot 1 with `sk-ant-admin01…` → 422 with the door's words; PUT slot 3 → 400; DELETE slot 1 → slot 1 unset; `grep -c` of the made-up key over `$APPS_LOG` → 0. A second probe with `CLAUDE_API_BIN` at a recording stand-in shows the argv (`set 1 --key-stdin --label … --credit … --renews …`), the key's byte count on stdin and its absence from argv, and a 400 answering with no door spawned.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/claude-api-keys.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts

## MAN-8963 — The Gemini plan cap — GET and PUT /api/settings/gemini-plan-cap, the one file the backend's gate reads

`server/modules/settings/gemini-plan-cap.ts` reads and writes the Gemini budget's cap: ONE dollar amount that every plan's (or chain's) Gemini spend is held to. The backend's gate reads the file at every Gemini call (`core/gemini_budget/ledger.py:cap_usd`, MAN-8959), so a PUT reaches the next call with nothing restarted on either side. Not a row in `auth.db`: the enforcer is a separate service with no database and no HTTP in its way.

## The file
| fact | value |
|---|---|
| default path | `/opt/shadow-connector/state/gemini_plan_cap.flag` |
| path seam | `GEMINI_PLAN_CAP_FILE`, read at every call (`capPath()` is a function); used when set and not blank (Python's `strip()` set, as `ledger._path_from_env`); made absolute with `path.resolve(expandHome(..))` |
| default cap | `GEMINI_PLAN_CAP_DEFAULT = 5` (= `ledger.DEFAULT_CAP_USD`) |
| reader / writer | `readFlagText` / `writeFlag` from `heal-switch.ts` (MAN-630): one bound, one BOM rule, one scratch-file-and-rename for every flag file here |
| written line | `${usd}\n`; `7.5` → `7.5\n`, `0` → `0\n`, `1e21` → `1e+21\n` |

## Reading — `getGeminiPlanCapState()`
THERE IS NO OFF STATE: no `null`, never "no ceiling" (cf. the heal cap, MAN-630). Every reading it cannot trust is `{usd: 5}`.

| file reads as | answer |
|---|---|
| absent, unreadable, longer than 256 bytes, empty, not a decimal (`DOLLARS`), negative, not finite | `{usd: 5}` |
| `0`, `-0` | `{usd: 0}`: a real cap, and a tight one — every call has already met it |
| a decimal of 0 or more (one leading BOM off, Python's `strip()`, ASCII digits) | that figure |

Empty is tested by hand before `Number()`: `Number('')` is 0, and an empty file reading as zero would refuse every Gemini call where the backend reads the default.

The grammar is written twice, here and in `ledger.cap_usd`, and answers the same number for the same bytes. 2026-10-22: 30 byte shapes (BOMs, NEL and C0 separators, invalid UTF-8, trailing NUL, the 256/257-byte bound, `1e999`, `-0`, `.5`, `5.`, `1_000`, `nan`, file absent), 0 disagreements. A FIFO at the path is equal too: it reads the default, `5`, at once (INV-9509).

## Routes
`GET`/`PUT /api/settings/gemini-plan-cap` in `settings.routes.ts`, host-wide: no `userId` is read, unauthenticated is 401 (the `/api/settings` mount).

| verb | body | answer |
|---|---|---|
| `GET` | none | `{usd}` |
| `PUT` | `{"usd": number}`, finite and 0 or more | `{usd}` READ BACK off the file, never the input |
| `PUT` | anything else: `"5"`, negative, `null`, `true`, absent | 400 `INVALID_GEMINI_PLAN_CAP`, `usd must be a dollar amount of 0 or more`; the file is untouched |

- `settings.service.ts` `getGeminiPlanCap` / `setGeminiPlanCap` delegate verbatim to `getGeminiPlanCapState` / `setGeminiPlanCapState` (the service file is over its ceiling and takes call-in lines only).
- No `dispatcher kick` on a write (cf. MAN-1497 §"THE KICK"): nothing queues on the cap; the gate re-reads the file itself.
- A blank or negative is a 400 and not a coercion: there is no "no ceiling" for either to mean. `"5"` is a dollar amount nobody typed as one.

## Shown by
Probe server over a scratch file (`GEMINI_PLAN_CAP_FILE` under `mktemp -d`), never the real cap file: `PUT {"usd":7.5}` → `{"usd":7.5}` and the file holds `7.5\n`; `PUT` of `-1`, `"5"`, `{}`, `null`, `true` → 400 `INVALID_GEMINI_PLAN_CAP`; `PUT 0` → `0\n`; `GET` with no file → `{"usd":5}`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/gemini-plan-cap.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts
