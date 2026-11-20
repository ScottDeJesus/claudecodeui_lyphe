<!-- docstore export; edit rows with docstore write, never this file -->

## MAN-10046 — server/modules/kanban-dispatch — the ticket door: fileTicket and clearTicket, how a server module files a defect on the house bug line

`server/modules/kanban-dispatch/kanban-dispatch.door.ts`, exported from the module's barrel, is how a server module that DETECTS a defect files it on the house's bug line and says it is gone. Today its one consumer is Cerberus's red watch (`server/modules/cerberus/red-watch-tickets.ts`, MAN-9205).

| export | does |
|---|---|
| `fileTicket({ source, key, service, title, words, priority }) -> Promise<string>` | one `dispatcher bug file --title <title> --priority <priority> --service <service> --key <key> --source <source>`, the words on stdin |
| `clearTicket(key, note) -> Promise<string>` | one `dispatcher bug cleared --key <key> --note <note>` |
| `TicketFiling`, `TicketDetector` (`cerberus` \| `nightly`), `TicketPriority` (`low` \| `medium` \| `high`) | the filing's shape; a chat or a soul files from its own shell with `~/.claude/scripts/bug`, never through this door |

THE ANSWER is the dispatcher's own first stdout line (`FILED ticket <id> — <title> — for <path>`, `ALREADY FILED ticket <id> — <title>`, `REOPENED …`, `CLEARED ticket <id> — <title>`, `no open ticket holds <key>`, or a refusal `REFUSED bug file: <reason>`); with no stdout and no exit code (killed at the 20-second ceiling, or never started), `bug <act> did not answer within 20 s (stopped at the ceiling, or it could not be started)`; else the last stderr line (a traceback's exception), cut to 200 characters; with neither, `bug <act> exited <code>`. Neither function ever throws: a throw while composing the command answers `bug <act> did not run: <message>`. The caller logs the line; nothing reads it as a verdict.

THE COMMAND is composed at each call, not at import: the dispatcher's entry point (`dispatcherBin()`, `DISPATCHER_BIN` moves it), a 20-second ceiling (a filing is one store write), and `sessionlessEnv()`, so no `CLAUDE_CODE_SESSION_ID` rides along: a machine is nobody's chat. `DISPATCHER_HOME` reaches the child from the process's own environment, which is how a probe points the door at a scratch home.

THE HOUSE DECIDES EVERYTHING ELSE: which folder a `--service` names (`charters/bugs.toml`; a service with no line, such as `system`, is refused by name), whether an open ticket already holds the key, whether a cleared one is reopened. The door opens no file under the dispatcher's home and writes nothing of the board's.

## Prove it
`cloudcli-tsx` a scratch file that imports `fileTicket` / `clearTicket` from the barrel and prints their answers, run with `DISPATCHER_HOME` a scratch folder: a first filing answers `FILED`, the same key again `ALREADY FILED`, `service: 'system'` the refusal, and `clearTicket` of an unknown key `no open ticket holds <key>`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/index.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.door.ts

## MAN-10050 — server/modules/kanban-dispatch — the placing pass: each filed bug ticket becomes a card on the board whose folders hold its path, and a walk's Done is said back to a person

The house files bug tickets (`~/.claude/scripts/bug file`, `hooks/dispatcher/bug_file.py`); `kanban-dispatch.tickets.ts` (`createTicketPlacer`, `TICKET_SOURCES`, `isPlacedTicketCreation`) puts each one on a board. `kanban-dispatch.tickets-read.ts` (`readPending`, `PendingTicket`, `TICKET_SOURCES`, re-exported by tickets.ts) reads `bug pending --json` field by field; a ticket that does not read (a `questions` ticket with no question included) costs only itself and is logged. The server runs dispatcher verbs and reads what they print; it opens no file of the dispatcher's.

## When it runs
| wake | pass |
|---|---|
| every applier pass (`kanban-dispatch.apply.ts`), FIRST, before `card notes` | `dispatcher bug pending --json`: the `filed` tickets, oldest first |
| server start; `board.created`; `board.updated` whose payload `fields` hold `repos` or `archived` (a restore) | the same with `--unplaced`: the tickets no board could take as well |
The applier is poked by the dispatcher's store watch (a ticket write counts on the board counter), so a filed ticket is placed at the write that filed it. The board wake is the module's second `onKanbanWrite` listener (`mayPlaceWaitingTickets`, `kanban-dispatch.module.ts`). No timer.

## Per ticket
1. `kanbanBoardsService.boardForPath(path)`: the live board whose `repos` hold the longest folder that is the path or contains it.
2. No board: stamp `{"unplaced": "no board names <path>"}`.
3. A board: a card of that board already carrying the tag `ticket:<id>` (archived ones included) is the ticket's card and is stamped again, never made twice. Otherwise `createCard(board, {title, description, priority, status})` with actor the ticket's `source` (`chat`, `soul`, `nightly`, `cerberus`, `hunter`); the status is the ticket's `lane`: `todo`, `active` for a ticket the night's cure walk already owns, and `todo` for `questions`. Then `addTag` of `ticket:<id>` FIRST, each of the ticket's tags, and `addAttachmentFromPath` per shot, same actor, each in its own try: a failed tag or shot is logged and the card is still stamped.
3a. THE QUESTIONS LANE: a security bug hunter's `--needs-you` ticket is listed with `lane: "questions"` and `question: {text, options}` (`Go ahead` / `Leave it with me`). After its tags, `kanbanQuestionsService.addQuestion(card, {text, options, otherOn: false})`, same actor, asks it; that one write moves the card from To Do to the questions status. A card re-found by its tag while still in To Do is asked then (a pass that died between the create and the ask). A failed ask is logged and the card is still stamped. On a board that runs itself the stamp parks the row `asking` and writes the same question as a note; the applier's `askOnce` finds it open by its text and asks nothing twice.
4. Stamp: `dispatcher bug placed <id> --result -` with `{"board": {"id","name","repos","autonomy"}, "card": {"id"}}` (`dispatcher shapes bug-placed`). The stamp writes the dispatcher's row for the card (queued, sorted, or `withdrawn` / `board off` on a board whose switch is off) and kicks the daemon.
- The `ticket:<id>` tag is the board's own record that a ticket has a card: a restart, a second server during a dev handover, or a forgotten stamp finds the ticket still `filed` and stamps the card already made. The one gap left is two server PROCESSES between `createCard` and that tag's write (two transactions); within one process both run in one synchronous turn.
- An `{unplaced}` stamp that did not take is never owed: the next pass reads the boards again, so a board made meanwhile takes the ticket. A `{board, card}` stamp that did not take (any non-zero exit, a refusal included) is OWED in memory, keyed by ticket id, and retried every pass until it lands, whether or not the ticket is still listed: a ticket that ended while its stamp was owed is answered by the house as a late stamp (`bug_place._late` links the card), so no card is left with no row.
- A card that could not be made is logged and the ticket stays `filed` for the next pass.
- Timeouts: the listing 20 s; the stamp 180 s (`TELL_TIMEOUT_MS`), because on a board that runs itself `bug placed` sorts the card before it answers.
- Every failure is one line in the journal, `[kanban-dispatch] ...`, said once; a placing failure never stops the notes.

## The teller's skip
`tellFor` (`kanban-dispatch.tell.ts`) answers null for a `card.created` whose actor is in `TICKET_SOURCES` (`isPlacedTicketCreation`): the stamp already wrote the row. Every later write of that card is told as any card's is.

## The word back — `kanban-dispatch.word.ts` (`announceFixed`)
When a `status` note moves a card INTO Done (a real move, not a re-applied note), every active user is handed one notification event: `provider: 'system'`, code `bug.fixed`, meta `{ boardName, title, changelog }`, severity `info`, dedupe key `bug.fixed:<user>:<card>:<doneAt>` (per user, because the orchestrator's dedupe is process-wide; per Done stamp, so a card fixed again after a reopening is news again). Kind `stop` when `kanbanCardsService.createdBy(card)` is `operator` or `restorly` (a person filed it: pushed by his preferences), else `record` (history and the station's strip, never pushed). Copy (`notification-copy.service.ts`): title `Fixed: <title>`, body the changelog line · the board's name. Never throws; one user's failure is logged and the rest are told.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.tickets-read.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.tickets.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.word.ts

## MAN-10066 — server/modules/kanban-dispatch — the bug hunters' relays: hunt settings, nights and reopen, and the proposed features' listing and acts

`kanban-dispatch.hunts.ts` (`createHuntsRouter`) and `kanban-dispatch.proposals.ts` (`createProposalsRouter`) are the bug hunters' two relays, mounted by `kanban-dispatch.routes.ts` at `/hunts` and `/proposals` under `/api/kanban-dispatch`, behind the mount's `authenticateToken`. Each route is ONE dispatcher command through `kanban-dispatch.verb.ts`; the server opens no file of the dispatcher's and keeps no state (`charters/hunts.toml`'s one writer is `dispatcher hunt config`).

## The relay — `kanban-dispatch.verb.ts`
| dispatcher answer | HTTP |
|---|---|
| exit 0 | 200: `{ line }` (the first line, `relayLine`) or the printed JSON object whole (`relayJson`) |
| exit 2 with a stdout line | 409 `{ error: "REFUSED hunt config: minutes must be a whole number from 15 to 600, not 900" }`, the dispatcher's sentence untouched |
| any other exit, no answer, exit 2 with nothing on stdout (argparse's own usage error, e.g. a verb this dispatcher build lacks), JSON that is not an object | 502 `{ error }` naming the verb and the LAST stderr line; logged `[kanban-dispatch] …` |
| a body or param the route cannot read | 400 with the route's own sentence; no command runs |
- Options go as `--flag=value`, so a value starting with `-` is never read as a flag; a positional (`hunt reopen`'s three) must be text of at most 500 chars with no newline that does not start with `-` (`isArgText`). Ids are `^[1-9][0-9]{0,9}$` (`routeId`).
- Commands run with the module's `commands` (20 s, `sessionlessEnv()`).

## Hunts — `/api/kanban-dispatch/hunts`
| route | body | runs |
|---|---|---|
| `GET /settings` | — | `hunt config --json` → the config object |
| `PUT /settings` | `{nightly?: bool, start?: str, minutes?: int, order?: str[], turns?: str, projects?: str[], ticketsPerNight?: int}`, at least one | `hunt config [--nightly=on\|off] [--start=] [--minutes=] [--tickets=] [--turns=] [--order=a,b] [--projects=n1,n2] --json` → the config as it stands after the write |
| `POST /night` | `{minutes?: int}` | `hunt night --now [--minutes=N]` → `{line}` |
| `POST /stop` | `{now?: bool}` | `hunt stop [--now]` → `{line}` |
| `POST /reopen` | `{hunt, project, unit}` (`project` is the project's NAME in the config) | `hunt reopen HUNT PROJECT UNIT` → `{line: "REOPENED <unit>"}` |
- The route checks TYPES only (an unknown key, a wrong type, a comma in an `order`/`projects` entry: 400). Bounds, kinds and project names are the dispatcher's: Settings shows its 409 sentence under the field. `order: []` sends `--order=` (no hunter takes a turn).

## Proposals — `/api/kanban-dispatch/proposals`
| route | body | runs |
|---|---|---|
| `GET /?board=<id>\|all&state=open\|all` | — | `bug proposals [--all] --json` → `{ proposals: BugProposal[] }` |
| `POST /:id/promote` | `{arc}` (an epic's name) | `bug proposal promote ID --arc=<arc> --by=app:card` |
| `POST /:id/send-back` | — | `bug proposal send-back ID` (prints the ticket's `FILED` line) |
| `POST /:id/dismiss` | `{reason}` 1–500 chars after trim | `bug proposal dismiss ID --reason=<reason>` |
| `POST /:id/priority` | `{priority}` low\|medium\|high | `bug proposal priority ID <priority>` |
- `board` is required (`all` or a board id); `state` defaults to `open`. The listing is read field by field by `readProposals` (`kanban-dispatch.proposals-read.ts`) into `BugProposalRecord`; a field it cannot read is a 502 naming it (`… answered the proposals[0].kind huge`). Each record's `path` goes through `kanbanBoardsService.boardForPath` (the placing pass's rule): with a board id only the proposals that board holds are kept; with `all` every one is. Each gains `boardName` (`''` when no board holds its folder). The dispatcher's order (high priority first, then oldest) is kept; an unknown board id keeps none.
- An act on a proposal that is not open, or that does not exist, is the dispatcher's 409 (`REFUSED bug proposal dismiss: no proposal 999`).

## Types — `server/shared/hunt-types.ts`
`BugProposalRecord` (the dispatcher's `PROPOSAL_KEYS`), `BugProposal = BugProposalRecord & {boardName}`, `BugProposalFinding`, `BugProposalStopgap`, and `HuntStatus` with `HuntNight`, `HuntHunter`, `HuntProjectStanding`, `HuntSkippedUnit`, `HuntSittingRow` (the dashboard's `hunts` part, MAN-10052), each word set a const (`HUNT_TURN_RULES`, `HUNT_PROJECT_STATES`, …). Re-exported from `server/shared/types.ts`; mirrored for the client in `src/shared/types.ts`. A promoted proposal's `feature.title`/`state` and a standing's `last.outcome` may be `null` (a feature since removed; a sitting still out).

## Verify
With the checks token (`node scripts/universe-token.mjs`): `GET …/hunts/settings` is the config; `PUT …/hunts/settings {"minutes":900}` is 409 with the dispatcher's sentence and writes nothing; `GET …/proposals?board=all&state=all` is `{"proposals": [...]}`.

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.hunts.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.proposals-read.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.proposals.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.verb.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/shared/hunt-types.ts
