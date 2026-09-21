# Memory intake

The **Memory** tab in the workspace: every memory a session proposed and could not write itself,
read whole and then filed or discarded by a person. It is not scoped to the selected project —
the queue is the whole estate's, so the same list shows under whichever project is open.
`src/modules/memory-intake/` is one provider (`context/MemoryIntakeContext`), two bodies that read
it — the Memory tab's pane (`MemoryIntakePanel`) and the desktop chat gutter's own body
(`MemoryWidgetBody`; its sibling for runs is `RunnerWidgetBody` in `src/modules/plan-runner`,
[plan-runner.md](plan-runner.md) §"The runner card") — two rows (`MemoryCandidateRow` for a pending
candidate, the read-only `MemoryApprovedRow` for one already filed) and two hooks: `useMemoryReview`,
the write lifecycle both bodies share, and `useApprovedMemories`, which reads the filed list beside
the provider's own queue. The pane also mounts `LessonReviewList`, a section of its own beneath the
queue (§"What the panel says"); it is the pane's alone, so the barrel does not export it. The barrel
exports the provider, its hook, `MemoryIntakePanel` and `MemoryWidgetBody`. The server half — the four routes, the read/write contracts, the failure
vocabulary — is the native module this page describes in §"The native module"; nothing in `src/` is
served by a proxy any more. The accounts and usage reads are the sibling module's, documented at
[accounts.md](accounts.md). The shapes on the wire are read from their declarations, not from a copy
here (see §"Where the shapes live").

**One provider, one poller.** `App.tsx` mounts `MemoryIntakeProvider` inside `ProtectedRoute`, so
the queue is never asked for against the login screen. The provider holds the READING alone: four
consumers read it — `useWorkspaceTabGates` three times over, once at each of its call sites (the
sidebar region that renders the strip, the main region, the command palette), and the panel — and
only the panel writes. The write lifecycle lives in `useMemoryReview` rather than in the context for
exactly that reason: a value carrying the in-flight id and the held refusals would change on every
button press and re-render all four.

## Where the tab is, and when

The tab sits on the workspace strip in the sidebar, after every other built-in tab except the
Runner tab ([plan-runner.md](plan-runner.md) §"The Runner tab") and before any plugin tab, and it
carries the pending count. The strip's built-in tabs are icon-only, so that count never reaches
Verve's `.vv-tabs__count` pill — `Tabs` draws that for word tabs only. The glyph wears a bare accent
dot instead, and the number is spelled out in the tab's `title` (`Memory (2)`), which is what
anything reading this strip's count reads. Both are absent below 1: a queue that has just been
emptied leaves a plain glyph rather than a zero nobody needs to read. That count is the memory
queue's alone (`pendingCount` in the provider): a staged lesson, though the pane now lists it,
neither adds to it nor keeps the tab on the strip.
`useWorkspaceTabGates(activeTab)` is the one place the rule lives; `ProjectSidebarRegion` (which
hands the strip its props), `WorkspaceMain` and `ProjectCommandPalette` all read it, so the strip,
the pane and the palette cannot disagree about whether the tab exists.

**The tab is sticky, and that is the whole design.** `shouldShowMemoryTab` is
`pendingCount > 0 || activeTab === 'memory'`: once it is the tab a person is standing in it stays on
the bar until they choose another one. Filing the last pending memory therefore empties the panel to
*All filed* instead of taking the tab out from under the person who just pressed the button.

That is also why there is no snap-back effect for it. `WorkspaceMain` has three, one each for the
tabs that vanish when a preference is switched off — tasks, shell, browser — because leaving the
workspace pointed at a tab no longer on the bar leaves an empty pane. The Memory tab is DATA-gated
rather than preference-gated, its gate is written to hold while it is selected, and a fourth effect
would fight that rule. The Runner tab is the second tab written this way and takes the rule whole,
snap-back and all — that is, none ([plan-runner.md](plan-runner.md) §"The Runner tab"). Two kinds of
tab, two policies, each in the layer that owns the act: the gate rule in the hook that decides a tab
exists, the navigation where `setActiveTab` is.

One move does leave it: choosing a conversation. The sidebar (`handleSessionSelect` in
`hooks/useProjectsState.ts`) and the command palette send every tab back to `chat`, because picking
a session is asking to read that session. The tab then stays on the strip while anything is pending and drops
off it when nothing is.

`memory` is a valid persisted tab (`VALID_TABS`), so a reload restores it — and the sticky clause
holds it there through the first paint, before the first poll has answered.

**In the palette.** `Go to Memory` (keywords `memory intake pending`) is offered exactly
when the tab is on the bar, since the palette reads the same hook. It carries no count.

## The reading, and when it is taken

| Asked | Why |
|---|---|
| on the provider mounting | the first picture, so the tab can be right before anyone looks |
| every 60 s | the same floor the accounts poller keeps; nothing here moves except when a session proposes a memory or a person reviews one |
| the browser tab returning to the foreground | a backgrounded interval is throttled to near-nothing, so what a person reads on return is a reading of now |
| the Memory tab opening | `MemoryIntakePanel`'s own mount read — the same reason, one level down |
| the end of every review | in a `finally`, after every outcome, so the list a person is looking at is the list after the write |

Two reads can be open at once — the interval's and the one a review asked for — so each takes a
token and answers are published in TOKEN order, never arrival order. An older answer landing after a
newer one is dropped rather than published: a poll that left before a review must not land after it
and put the reviewed row back on screen for a minute. Each answer replaces the queue wholesale; a
row kept from a previous reading would be a card no longer waiting for anyone.

`pending` is `null` until the first answer lands. That is "not asked yet", and the screen has to
tell it apart from `{reachable: false}` ("asked, and there was no picture to be had") — the first is
a spinner, the second is words.

## What the panel says

A header carrying *Memory intake* and, when there is a picture at all, a neutral `N pending` badge.
Below it, ONE `ScrollArea` for the whole tab, holding two sections: the memory queue, then the
lessons. The queue draws one of four things:

| The provider holds | The queue draws |
|---|---|
| `null` — nothing asked yet | a `Spinner` reading *reading…* |
| `reachable: false` | *The memory queue is not reachable right now.* — never *All filed* |
| a picture with no rows | *All filed* / *Nothing is waiting for review.* |
| a picture with rows | one `MemoryCandidateRow` each, in the server's own order |

The first three are blocks of their own height, not the pane's: a state that filled the pane would
push the lessons below the fold on the very visit where the queue has nothing to show.

The badge is drawn only on `reachable === true`. Stating "0 pending" above *The memory queue is not
reachable* would have the panel contradict itself in two adjacent lines.

**Beneath the queue, the lessons.** `LessonReviewList` is a SECTION of this tab — an `h3` under the
panel's `h2`, in the queue's own `max-w-2xl` column — and neither a third tab nor a second provider.
`MemoryIntakePanel` mounts it after the queue, inside the same scroll, whatever the queue holds, and
it draws its own four states: reading, could not be read, none staged, and the rows. The lifecycle —
the staged list, the one lesson opened whole, and the two reviews — is `useLessonReview`
(`hooks/useLessonReview.ts`), shaped like `useMemoryReview` one section over; it holds no interval of
its own, reading on mount and again after every write. Its badge reads `N staged` against the list it
read, or `N+ staged` when that read landed at the route's own ceiling (500 rows) — the most the client
can honestly claim without a total from the server. Its docstring carries the row and state design.
The lessons themselves — the store and its routes — belong to the board: [kanban.md](kanban.md)
§"The lessons lane".

**Its two verbs are the review itself.** `useLessonReview` reads the staged list on mount and again
after every write, then drives one write per lesson through `api.kanban.approveLesson` /
`rejectLesson` — `POST /api/kanban/lessons/:id/approve` and `…/reject` — which is the whole of the
REVIEW surface: the store, the staging door and the three read tools are the board's, and only the
person's two verdicts are answered here. Approving is what puts a lesson in the index a Metis's
`list_actionable` reads; rejecting discards the proposal. Both are refused before the credential
check on the board's own narrow mount (`kanbanMetisSecretGuard`,
`server/modules/kanban-metis/kanban-metis.routes.ts`), because reviewing is a person's act and which
credential arrived is not the question.

## One row

The heading line is the memory's `name`, then where it wants to land in plain English, then the
project when the candidate names one. The whole heading is the expander — `role="button"`,
`tabIndex={0}`, `aria-expanded`, Enter and Space — and expanding fetches that ONE candidate by id.
The list is lean by design: it carries no body, so the full text is read for the card that was
opened rather than for all hundred.

| `target` | The row reads |
|---|---|
| `memory` | memory note + index pointer |
| `topic` | memory note |
| `rules` | your RULES.md shelf |
| `requirements` | your REQUIREMENTS.md shelf |
| `claude` | global CLAUDE.md, plus the amber **global** badge |

An unknown sixth target renders as its own raw word — untranslated beats blank. The **global**
badge is the blast mark and the only guard on the one target that reaches every session in every
project and takes no size cap; its `title` says so. There is no confirmation dialog anywhere here:
expanding to read IS the deliberate step.

**The five targets, and what each is capped at.** `memory-caps.ts::MEMORY_CAPS` is the one home for
the numbers, keyed by file:

| Target | Capped at | Why |
|---|---|---|
| `memory` (a project's `MEMORY.md`) | 200 lines, 250 chars per line | it is an INDEX of one-line router pointers, so both dimensions are real |
| `topic` (the note it points at) | nothing measured | the shed the index points AT — length there is the point |
| `rules` (the RULES.md shelf) | 60 lines, 2,000 total chars | `hooks/load_main_shelves.py` injects each shelf whole on every SessionStart, and 60 / 2,000 is the budget each shelf's own header states |
| `requirements` (the REQUIREMENTS.md shelf) | 60 lines, 2,000 total chars | the same, the two shelves split by subject rather than by size |
| `claude` (global `CLAUDE.md`) | nothing measured here | its fences are elsewhere and deliberate — the 4,000-character `body` bound every candidate passes at staging, and the panel's own **global** warning |

A per-line budget belongs to exactly one file because a memory is PROSE and markdown prose is one long
line per paragraph: a per-line budget on `topic` or `claude` would refuse this lane's own happy path.
An entry that measures nothing produces no refusal, and fail-CLOSED applies only where a budget exists
— which here is absolute, since this predicate is compiled into the module, so there is no load that
could fail and no path on which a budgeted file is written unmeasured. The numbers and the ratchet are
PORTED from `~/.claude/hooks/enforce_memory_limits.py` (the predicate that guards a session's own
`MEMORY.md` edits, under the same lockstep `MEMORY_MAX_LINES=200` / `MEMORY_MAX_LINE_CHARS=250`), so
change a number in one and change the other in the same diff — the rule `store_memory_caps.py` states
of itself. Only the wording is ours: each refusal names the real file, the real number and a remedy
that exists, because that text becomes the candidate's recorded refusal — the words a person reads to
decide what to trim.

Expanded, the row shows the body in a `<pre>` that wraps, then *Why* (`rationale`) and *Index line*
(`indexLine`) where the server sent them. Every one of those strings is operator-authored free text and
reaches the DOM as a text node — never as markdown and never as markup, however much like markdown
it looks.

Three answers are not a body, and each gets its own sentence: a read that could not be made says
*The memory queue is not reachable right now.* and is retried on the next expand; a `candidate: null` and a
full read whose `status` is no longer `pending` both say *This memory is no longer pending — it was
reviewed elsewhere.* Those last two are the same news, which is why they share the words. Collapsing
keeps whatever was read — a pending memory's text does not change while it waits, so re-opening is
instant rather than another request.

A refusal, when there is one, sits under the heading: this tab's freshest one if the person just hit
the cap guard, otherwise the copy the server recorded on the row (which is what every OTHER tab sees).

## The two verbs

**file it** writes the memory to disk. **discard** writes nothing. Both are on every row, both are
disabled while any write is in flight, and each raises one toast:

| The write answered | The toast |
|---|---|
| 2xx on approve | positive — *filed — the memory is on disk* |
| 2xx on reject | positive — *discarded — nothing was written* |
| 422 | warn — *couldn't file that memory*, with the server's OWN text under it |
| 404 | neutral — *already reviewed elsewhere* |
| 503, or a thrown fetch | warn — *The memory queue is not reachable.*, with the reason in words |

**A 422 is a verdict, not a fault.** It is the module's own cap guard refusing in plain English and naming
what to trim; the card stays PENDING, the text is held per id for this tab's next paint, and the
refresh that follows also picks up the copy the server recorded on the row for every other tab. A
generic sentence in its place would leave the person with a pending card and no reason. That text
reaches the screen untouched: a refusal is the module's own plain English, the same rule the account
switcher's writes follow ([accounts.md](accounts.md) §"The two writes").

Two presses are handled by identity, not by a flag. The in-flight guard is a ref, read
synchronously, because `busyId` is a render value and lands too late to stop a second press in the
same tick. A press for the same card and the same verb JOINS the write already going; any other
press takes its turn behind it. It is never handed that write's answer and it is never dropped — a
press that waits still happens, on the card it was aimed at.

Every row's buttons go quiet during one write, not only the row being written. `busyId` holds one id
because the design writes one at a time, so painting only that row would leave the other five
looking pressable and turn a refused press into a press that vanished.

## The fence

Approving a candidate writes into files every future session in a project reads. That is why the
whole intake lane is HTTP-only and carries no agent seam — no MCP verb, not even a staging one.
This tab does not widen it. The routes sit behind `authenticateToken` like every other app route,
and a soul proposes while only a signed-in person files. What this lane adds is one
bearer-authenticated HTTP path and a pair of buttons; nothing here is callable by an agent.

## The native module

A second implementation of the same four contracts lives inside this server itself, at
`server/modules/memory-intake/` — `memory.service.ts` (the candidate lifecycle: stage, list, get,
approve, reject, over its own `memory_candidates` table, which is not a board table and carries no
`board_id`), `memory-assert.ts` (the disk half: every write path is DERIVED from a candidate's
`target`, `project` and `name` against the same five-entry allowlist named in the table under §"One
row" above — a row never carries a path of its own — and a `memory` candidate writes its topic note
before its `MEMORY.md` router line, so a mid-write fault leaves an orphan note rather than a
dangling index pointer), and `memory-caps.ts` (the size budgets, ported number-for-number from
`~/.claude/hooks/enforce_memory_limits.py` — the predicate that guards a session's own MEMORY.md
edits — so the two move together rather than drift apart). `index.ts` barrels the three for
`memory-intake.module.ts`, which the server entrypoint mounts at `/api/memory` behind
`authenticateToken` — and nowhere else: it is not on the board's router, so neither of that router's
two mounts ([kanban.md](kanban.md) §"The routes", §"The kanban-pm MCP surface") can reach it.

**The provenance column is `legacy_id`, and it is `NULL UNIQUE`.** A row that carries one carries a
provenance id minted elsewhere, so that id can appear at most once in this table and a row staged
here is never in conflict with it. `memory_candidates` carries no `board_id` and is not a board
satellite ([kanban.md](kanban.md) §"The tables").

The four routes are `GET /`, `GET /:candidateId`, `POST /:candidateId/approve` and
`POST /:candidateId/reject` — the four contracts this page describes, and
a refusal answers the same shape a person reads: `{ error: "<words>" }`, a thrown `MemoryRefusal`
caught at the route rather than the app's `{ success: false, error: { code, message } }` envelope. A
malformed id (`/^[A-Za-z0-9_-]{1,64}$/`) is refused at the door on all four.

**The client points here, and only here.** `MemoryIntakeContext`, `useApprovedMemories`,
`useMemoryReview` and the row all read and write through `api.memory` in `src/shared/api.ts`, whose
five calls are the four routes below. Nothing in `src/` calls a proxy any more, for this lane or any
other: the accounts and usage reads are `server/modules/accounts/` ([accounts.md](accounts.md)).

## Where the shapes live

`MemoryCandidateLean`, `MemoryCandidateFull`, `MemoryPending`, `MemoryCandidateRead` and
`MemoryReviewOutcome` are declared in `src/shared/types.ts` § MEMORY INTAKE CONTRACTS, mirroring
`server/shared/types.ts` § MEMORY INTAKE CONTRACTS field for field. The server file is the source and
carries the per-field documentation; a change to either shape belongs in both files at once. The
native module (§"The native module") imports the server-side declarations too — `MemoryCandidateFull`
and `MemoryCandidateLean` are read from `server/shared/types.ts`, never re-declared beside
`memory.service.ts`. The client calls the four routes through `api.memory` in `src/shared/api.ts` —
the reads answer 200 with the `{ reachable }` envelope, so a caller reads the BODY rather than the
status, and the writes are taken from the raw response because they carry the server's own verdict
through.

The lean row carries `sessionId` — the row's unverified provenance column resolved server-side to the
app session id (`sessionsDb.resolveAppSessionId`, wired in `memory.service.ts`), display only, gates
nothing — so a list can mark the memories the open chat proposed. Both lists come from the service's
one `list(status)` verb: `GET /api/memory?status=approved` reads the filed list, and any other status
reads the pending queue.

Every string but the lessons section's is in `src/modules/i18n/locales/en/common.json` under
`memory.*`, with the tab's own label at `tabs.memory`. English only, deliberately: the other ten
locales fall back to `en` (`i18n/config.ts`), which is a readable English word rather than a missing
key. The lessons section's `memory.lessons.*` strings are in no locale file: `LessonReviewList`
carries each one's English as the `defaultValue` of its own `t(...)` call and looks up only
`memory.reading`, which it shares with the queue.

The desktop chat gutter's own strings are the opposite case. `gutters.memory.*` — which
`MemoryWidgetBody` draws — and the `gutters.pin.*` marker it shares with the Runner widget are
written in all eleven locales, per the operator's instruction for this plan.

## What is left standing

- **The count is never part of the tab's name.** `Tabs` keeps `aria-label={tab.label}` as the
  accessible name so the harness can select by the bare word `Memory` and the label never grows a
  number, and the accent dot beside the glyph is `aria-hidden` outright — it says THAT something
  waits, never how much. The number itself rides the tab's `title`, a hover affordance rather than
  the tab's name; the panel's own `N pending` badge is where the count is stated in the pane a
  person is actually reading.
- **No row is announced when it arrives.** The queue can grow under a person reading it — the panel
  has no live region, so a memory proposed while the tab is open appears silently at the next poll.
- **A read that failed is retried, a read that succeeded is not.** `readFailed` leaves the card
  counting as "never asked", so the next expand tries again; a body already read is kept for the
  panel's life, including across a refresh that re-renders the row.
- **The queue is one flat list, in the server's order.** No grouping by target or project, no filter,
  no search — a queue that outgrows one screen is scrolled. Nothing here paginates.
- **`useBrowserUseEnabled` is three copies of one boolean.** Not this tab's, but it shares the hook:
  it is a per-call-site `useState` + fetch rather than a context, so the three `useWorkspaceTabGates`
  callers can disagree for the frame between their fetches landing. Pre-existing, and the cure is a
  context for it — never a fourth private reading inside the gates hook.

## Proving it

Two probes, and neither reviews a card. `node .verify/phase-19.mjs` is the HTTP half — the four
route contracts, no browser. `node .verify/phase-20.mjs` is this surface in headless Chromium: the
tab on the strip with its count and its untouched accessible name, one row per candidate, the global
mark, a body read on expand, both verbs offered, and the sticky rule driven both ways — the tab held
at zero while it is selected, then dropped on the first tab change and brought back when something
waits again. The zero-count half is produced by answering the tab's own read (`GET /api/memory`, the
path `api.memory.pending` calls) inside the page and re-reading through the provider's own visibility
path, so the live queue is left exactly as it was found. Shots are `20-memory-light`, `20-memory-expanded-light`, `20-memory-empty-light`,
`20-memory-390-light` and `20-memory-dark`. See [verification.md](verification.md).
