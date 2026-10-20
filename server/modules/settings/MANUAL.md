<!-- docstore export; edit rows with docstore write, never this file -->

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

**The key.** It is in the request body, on the child's stdin, and nowhere else: not argv, not the environment, not a log, not an error, not an answer. This module logs nothing at all; the body is never echoed in an error; and the words relayed from the door pass a key-shaped redaction (`sk-ant-…` → `[key]`) as a second seam, so a stand-in door that echoed its stdin still puts no key in an answer.

**The kick.** A SAVED or REMOVED write ends in `void kickDispatcher()` (MAN-1497 §"THE KICK"): a save clears that payer's walls, and the dispatcher's release asks whether another payer now carries the plan (`account_release.py`). A refused or failed write wrote nothing and kicks nothing.

**Shown by** (a scratch store, never the live one): `. scripts/apps-probe-env.sh; D=$(mktemp -d); PLAN_RUNNER_CLAUDE_API_KEYS=$D/keys.json PLAN_RUNNER_CLAUDE_API_HOME=$D/home DISPATCHER_HOME=$D/state/dispatcher boot_probe_server`, then with `mint_token`: GET both slots unset; PUT slot 1 with a made-up `sk-ant-api03…` key, a label and a renewal day → 200, slot 1 set, no key in the body; PUT slot 1 with `sk-ant-admin01…` → 422 with the door's words; PUT slot 3 → 400; DELETE slot 1 → slot 1 unset; `grep -c` of the made-up key over `$APPS_LOG` → 0. A second probe with `CLAUDE_API_BIN` at a recording stand-in shows the argv (`set 1 --key-stdin --label … --credit … --renews …`), the key's byte count on stdin and its absence from argv, and a 400 answering with no door spawned.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/claude-api-keys.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/settings/settings.routes.ts
