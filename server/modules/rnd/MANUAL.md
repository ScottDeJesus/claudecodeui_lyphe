<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-10113 — server/modules/rnd — the R&D relay: GET /api/rnd, the place writes, the spike route and the rnd_state frame

**The R&D relay.** `server/modules/rnd/` is the stateless relay behind the R&D place: one read of the dispatcher's R&D document, the `rnd_state` frame, and the place's writes, each ONE `dispatcher rnd` verb. The dispatcher owns the candidates, their words, the settings, the scout and every refusal (`hooks/dispatcher/store_rnd.py`, `rnd_acts.py`, `rnd_report.py`); nothing here writes the store or decides a word. Mounted in `server/index.ts` as `app.use('/api/rnd', authenticateToken, rnd.router)`; `rnd.start()` and `rnd.stop()` run beside the roadmap lane's.

| file | holds |
|---|---|
| `rnd.module.ts` | the composition root: the lane, the broadcast, the journal door (`[R&D]`, each message once), the spike's model door |
| `rnd-state.service.ts` | `readRndState`: `rnd show --json` under `RND_MAX_BUFFER` (4 MiB), checked field by field into `RndPicture` (a field it cannot read throws a sentence naming its path; keys the contract does not name are dropped); `readRndCandidate` (an adopted candidate's `adopted.measure`: `{says, promised}` from its design's `[measure]` row, or null until one is named — carried as the dispatcher prints it); `RND_REFUSAL_EXITS` |
| `rnd.routes.ts` | the routes: fence, compose argv, relay, poke |
| `rnd-spike.service.ts` | `startSpike` and the `/spike` prompt |

THE LANE. `createPolledLane<RndPicture, RndStateEvent>`: snapshot `readDispatcherJson(['rnd','show','--json'], …, RND_MAX_BUFFER)`, frame `{kind: 'rnd_state', ...picture, at}`, `serialize` without `generated_at` (the roadmap lane's reason), `backstopMs: null` — NO timer. It reads when the store watch fires its `rnd` lane (MAN-9543: a store write the board gate lets through, a re-armed watch) and after every write route here that answered 200. `FIRST_READ_WAIT_MS` 5000; before the first reading GET answers 200 `{error: 'the R&D picture has not been read yet'}`.

THE ROUTES. Every write runs over the bug hunters' relay (`runVerb`, `relayJson`, `relayLine`, `bodyOf`, `isArgText`, `sendBadRequest`, exported from `server/modules/kanban-dispatch/index.ts`), passing `RND_REFUSAL_EXITS` [1, 2] — the roadmap verbs' form, where 1 is a name the store does not hold: 200 the verb's first line as `{line}` (or its JSON object), 409 a refusal with the dispatcher's own sentence, 502 a fault, 400 a fence that ran nothing. A name or a positional/flag value must not begin with a dash (`isArgText`); free text (why, label) travels as `--flag=<text>`, one argv element, at most 4000 characters. `COMMAND_TIMEOUT_MS` 30 s (`rnd scout --now` opens a launch before it answers).

| route | body | dispatcher |
|---|---|---|
| GET / | | the lane's picture |
| PUT /settings | `{webSearch?: boolean, scoutsRun?: 'one_at_a_time'\|'all_at_once', frequency?: 'off'\|'daily'\|'weekly'\|'monthly', day?: 'mon'..'sun' \| 1-28, time?: 'HH:MM'}`, at least one | `rnd config [--web-search on\|off] [--scouts-run one-at-a-time\|all-at-once] [--frequency …] [--day …] [--time …] --json` — answers the settings as they now stand; the schedule words move the rnd-scout crontab line through the verb, which refuses a day its frequency cannot take in its own sentence |
| POST /sources | `{url, label?}` | `rnd source add <url> [--label=<words>]` |
| DELETE /sources | `{url}` | `rnd source remove <url>` |
| POST /scout | | `rnd scout --now` |
| POST /candidates/:name/adopt | `{}` (nothing in it is read) | `rnd adopt <name> --by app:card` — answers `PLACING candidate …` at once; Opus places it and its design starts (`rnd_place`, MAN-10128) |
| POST /candidates/:name/reject | `{why}` | `rnd reject <name> --why=<words>` |
| POST /candidates/:name/reopen | | `rnd reopen <name>` |
| POST /candidates/:name/spike | `{projectPath}` | see below; answers `{sessionId, prompt, model}` |

THE SPIKE. `startSpike`, each step only once the one before answered: `rnd show --json <name>` (a refusal travels back as 409), the model from `launch-table resolve rnd.spike --side claude` through agent-launch's CLI door (`resolveLaunchRow`, `server/modules/agent-launch/index.ts`; asked BEFORE the chat exists, so a table that cannot answer leaves no chat), `sessionsService.createAppSession('claude', projectPath, prompt, true)` (born on the simple chat list, as the page's New chat is, and announced with `broadcastSessionUpserted`), then `rnd spike <name> --session <sessionId>`. The prompt is `/spike <question>`, a blank line, then `Candidate:`, `What it is:`, `Why it might help:`, `Source:` lines. No step leaves a chat nobody uses: a candidate whose word is `rejected` or `adopted` (which the stamp refuses, `store_rnd._refuse_closed`) is refused 409 before the row is made, and when the stamp fails after the row exists the row is deleted (`sessionsDb.deleteSessionById`) and the dispatcher's sentence travels back. The client sends the chat's first message only after a 200. THE CARD'S CHATS. A spike's `session` is its own chat, stamped by this route with the app's id; `launched_from` is the chat a spike with no chat of its own was launched from (/spike typed in a chat; its work is a background agent there), stamped by the /spike skill with the CLI's `$CLAUDE_CODE_SESSION_ID` through `rnd spike --launched-from`. The lane's snapshot (`withSpikeChats`, `rnd.module.ts`) reads both through `sessionsDb.resolveAppSessionId` (current mapping, then superseded ids), drops a launcher that is the spike's own chat (this route's chat runs /spike too), and adds `launched_from_name`. The card offers "Open chat" only for `session`, and says "Launched from <name>" for `launched_from`; an id no row carries stays as stamped with no name.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/rnd/rnd.module.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/rnd/rnd.routes.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/rnd/rnd-spike.service.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/rnd/rnd-state.service.ts
