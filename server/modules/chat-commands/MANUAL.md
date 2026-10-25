<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-8992 — chat-commands — the chat credential, its guard, the account of a chat and the command link, shared by `toolset`, `notes` and `followups`

The shared ground of the shell commands a chat runs against CloudCLI (`toolset`, `notes`, `followups`): what each needs from the server so that a model can act inside its own chat and nowhere else. The commands themselves: MAN-8501 (`toolset`), the notes command (its row is in `docs`, MAN-8993) and the followups command (its row is in `docs`, MAN-9004; the lane's store and doors, MAN-9003). The doors that use this: MAN-8499 (`/api/toolsets-cmd`), `/api/notes-cmd` and `/api/followups-cmd`.

| file | owns |
| --- | --- |
| `chat-commands.credential.ts` | `chatCredential(appSessionId)`, `chatCredentialMatches(appSessionId, given)` |
| `chat-commands.guard.ts` | `chatCredentialGuard` (the Express middleware), `chatAppSessionOf(response)`; module-private `readBearer`, `appSessionForCredential` |
| `chat-commands.account.ts` | `accountOfChat(appSessionId)` |
| `chat-commands.link.ts` | `ensureChatCommandLink(commandName, logLabel)` |
| `index.ts` | the barrel: those four, nothing else |

Consumers are `toolsets` (the launch hook hands out the credential; its command router mounts the guard; its module links `toolset`), `notes` (its command router mounts the guard and asks the account; its module links `notes`) and `followups` (its command router mounts the guard and asks the account only to `add`; its module links `followups`). All reach this module only through the barrel.

## The credential

| fact | value |
| --- | --- |
| value | `chatCredential(appSessionId)` = hex HMAC-SHA256 of `toolset:${appSessionId}`, keyed by `JWT_SECRET` (exported by `server/modules/auth/index.ts` for this) |
| one per chat, shared | a chat carries ONE credential (`CLOUDCLI_TOOLSET_TOKEN`, with `CLOUDCLI_TOOLSET_URL`), and every command it runs sends that same one. There is no second credential and no second derivation: a new command's door mounts `chatCredentialGuard` and nothing else |
| the `toolset:` prefix | the scheme's history, kept byte for byte. The digest is already in the environment of every chat that was launched, so a different derivation would lock all of them out of every command door until their next process. It also keeps the credential from standing in for the `kanban-pm` door's, derived the same way |
| stored | nowhere: the launch hands the digest to the CLI, the guard recomputes it. A restart changes nothing; a chat that ended is a row that is gone |
| compared | `chatCredentialMatches`: `crypto.timingSafeEqual` after a length check |
| scope | one chat. A model holding it cannot act as another chat. The operator's JWT never enters a CLI's environment, and the operator's own mounts (`/api/notes`, `/api/toolsets`) refuse this credential (401 from `authenticateToken`) |
| rotation | `JWT_SECRET` is `process.env.JWT_SECRET` or the database's persisted secret; changing it makes every running CLI's credential refuse, and the commands report that CloudCLI does not know the session until the chat's next process |
| a soul's shell | a subagent soul launched from a chat inherits the PARENT chat's environment, so its shell holds the parent's credential beside its own `CLAUDE_CODE_SESSION_ID`; the guard refuses that pair (the credential names a different session) and the commands answer as for an unknown session. Measured 2026-10-25 |

## The guard — `chatCredentialGuard`

The FIRST middleware of a command router, so no path of the router skips it; the mounts carry no `authenticateToken` on purpose (the command holds no user token).

1. Bearer from `Authorization` (scheme case-insensitive) and `claudeSessionId` from the body.
2. `appSessionForCredential(claudeSessionId, bearer)`: `SESSION_ID_PATTERN`, then `sessionsDb.resolveAppSessionId` (the CLI holds a Claude id), then `getSessionById`, which must be a Claude row, then `chatCredentialMatches`.
3. Any miss → 401 `CHAT_CREDENTIAL_REFUSED`, "This credential does not belong to a CloudCLI chat with that session id." One answer for no bearer, malformed id, unknown session, non-Claude chat, wrong credential and the operator's JWT alike.
4. A pass puts the chat's app session id in `response.locals`; a route reads it back with `chatAppSessionOf(response)` and never trusts the body for it. Read on a route that is not behind the guard, it throws.

## The account of a chat — `accountOfChat`

The `sessions` table records no owner: a chat row names its project, model and tool sets and no account, and `users` holds more than one account on this box (the harness's `verve` and the operator's own), so "the first user" and "the only user" are both wrong answers. The owner is read where the app records who started the run:

| order | source | holds |
| --- | --- | --- |
| 1 | the run registry, `chatRunRegistry.getRun(appSessionId).writer.userId` | the account the socket that sent the turn was signed in as; in memory, so a command made inside a turn costs nothing |
| 2 | the live host's meta, `listLiveHosts()` → `userId` | the same value, written at spawn and read back at re-adoption, for a CLI that outlived the API or a run the registry no longer holds; it reads tmux and every host's meta, so it is asked only when the registry has no answer |

- The id must be a positive integer (a numeric string is read as one) and name an ACTIVE user (`userDb.getUserById`); otherwise the answer is `null` and the door refuses with 403 `CHAT_ACCOUNT_UNKNOWN`. Nothing is guessed: a note written for the wrong account is worse than a note not written.
- A run started by something with no login carries `userId: null` and so has no account here.

## The link — `ensureChatCommandLink(commandName, logLabel)`

Called once at creation by `createToolsetsModule()` (`'toolset'`, `'toolsets'`), `createNotesModule()` (`'notes'`, `'notes'`) and `createFollowupsModule()` (`'followups'`, `'followups'`), each wrapped: a failure is one warning and the API stays up. Keeps `~/.local/bin/<commandName>` a symlink to `<application root>/bin/<commandName>.mjs`; `~/.local/bin` is made if missing.

| state found | does | journal |
| --- | --- | --- |
| script missing from the install | nothing | one `[<logLabel>]` warning |
| no link there | creates the symlink; losing the race to the other server of a handover (`EEXIST`) is the outcome wanted | `linked <link> -> <target>` |
| a regular file | leaves it alone (the operator's) | one warning |
| a symlink to the target | nothing | silent |
| a symlink elsewhere | re-points: `<name>.<pid>.tmp` beside it, renamed over, so a chat's Bash never meets a gap | `re-pointed <link> from <old> to <target>` |

How `~/.local/bin` reaches a chat's PATH (the operator's `~/.claude/settings.json` `env.PATH`, not the unit's): MAN-8501.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/chat-commands/
