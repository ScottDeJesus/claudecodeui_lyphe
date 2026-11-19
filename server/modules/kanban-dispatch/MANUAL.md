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

The house files bug tickets (`~/.claude/scripts/bug file`, `hooks/dispatcher/bug_file.py`); `kanban-dispatch.tickets.ts` (`createTicketPlacer`, `TICKET_SOURCES`, `isPlacedTicketCreation`) puts each one on a board. The server runs dispatcher verbs and reads what they print; it opens no file of the dispatcher's.

## When it runs
| wake | pass |
|---|---|
| every applier pass (`kanban-dispatch.apply.ts`), FIRST, before `card notes` | `dispatcher bug pending --json`: the `filed` tickets, oldest first |
| server start; `board.created`; `board.updated` whose payload `fields` hold `repos` or `archived` (a restore) | the same with `--unplaced`: the tickets no board could take as well |
The applier is poked by the dispatcher's store watch (a ticket write counts on the board counter), so a filed ticket is placed at the write that filed it. The board wake is the module's second `onKanbanWrite` listener (`mayPlaceWaitingTickets`, `kanban-dispatch.module.ts`). No timer.

## Per ticket
1. `kanbanBoardsService.boardForPath(path)`: the live board whose `repos` hold the longest folder that is the path or contains it.
2. No board: stamp `{"unplaced": "no board names <path>"}`.
3. A board: a card of that board already carrying the tag `ticket:<id>` (archived ones included) is the ticket's card and is stamped again, never made twice. Otherwise `createCard(board, {title, description, priority, status: lane})` with actor the ticket's `source` (`chat`, `soul`, `nightly`, `cerberus`); `lane` is `todo`, or `active` for a ticket the night's cure walk already owns. Then `addTag` of `ticket:<id>` FIRST, each of the ticket's tags, and `addAttachmentFromPath` per shot, same actor, each in its own try: a failed tag or shot is logged and the card is still stamped.
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

governs: /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.tickets.ts, /home/lyphe/.claude/claudecodeui_lyphe/server/modules/kanban-dispatch/kanban-dispatch.word.ts
