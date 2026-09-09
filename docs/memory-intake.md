# Memory intake

The **Memory** tab in the workspace: every memory a session proposed and could not write itself,
read whole and then filed or discarded by a person. It is not scoped to the selected project —
Descent's queue is the whole estate's, so the same list shows under whichever project is open.
`src/modules/memory-intake/` is one provider (`context/MemoryIntakeContext`), one panel
(`MemoryIntakePanel`), one row (`MemoryCandidateRow`) and the panel's private write lifecycle
(`hooks/useMemoryReview`); the barrel exports the first two and the provider hook. The server half —
the four routes, the read/write contracts, the failure vocabulary — is
[descent-proxy.md](descent-proxy.md), and the shapes on the wire are read from their declarations,
not from a copy here (see §"Where the shapes live").

**One provider, one poller.** `App.tsx` mounts `MemoryIntakeProvider` inside `ProtectedRoute`, so
the queue is never asked for against the login screen. The provider holds the READING alone: four
consumers read it — `useWorkspaceTabGates` (twice over, for the strip and for the main region), the
command palette, and the panel — and only the panel writes. The write lifecycle lives in
`useMemoryReview` rather than in the context for exactly that reason: a value carrying the in-flight
id and the held refusals would change on every button press and re-render all four.

## Where the tab is, and when

The tab sits on the workspace strip in the sidebar, after every other built-in tab and before any
plugin tab, and it carries the pending count as Verve's own pill. The pill is absent below 1 — a
queue that has just been emptied leaves a bare label rather than a zero nobody needs to read.
`useWorkspaceTabGates(activeTab)` is the one place the rule lives; `WorkspaceTabs`,
`WorkspaceMain` and `ProjectCommandPalette` all read it, so the strip, the pane and the palette
cannot disagree about whether the tab exists.

**The tab is sticky, and that is the whole design.** `shouldShowMemoryTab` is
`pendingCount > 0 || activeTab === 'memory'`: once it is the tab a person is standing in it stays on
the bar until they choose another one. Filing the last pending memory therefore empties the panel to
*All filed* instead of taking the tab out from under the person who just pressed the button.

That is also why there is no snap-back effect for it. `WorkspaceMain` has three, one each for the
tabs that vanish when a preference is switched off — tasks, shell, browser — because leaving the
workspace pointed at a tab no longer on the bar leaves an empty pane. The Memory tab is DATA-gated
rather than preference-gated, its gate is written to hold while it is selected, and a fourth effect
would fight that rule. Two kinds of tab, two policies, each in the layer that owns the act: the gate
rule in the hook that decides a tab exists, the navigation where `setActiveTab` is.

One move does leave it: choosing a conversation. `handleSessionSelect` sends `tasks`, `browser` and
`memory` back to `chat` (`hooks/useProjectsState.ts`), because picking a session is asking to read
that session. The tab then stays on the strip while anything is pending and drops off it when
nothing is.

`memory` is a valid persisted tab (`VALID_TABS`), so a reload restores it — and the sticky clause
holds it there through the first paint, before the first poll has answered.

**In the palette.** `Go to Memory` (keywords `memory intake pending descent`) is offered exactly
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
Below it, one of four things:

| The provider holds | The panel draws |
|---|---|
| `null` — nothing asked yet | a `Spinner` reading *reading…* |
| `reachable: false` | *Descent is not reachable right now.* — never *All filed* |
| a picture with no rows | *All filed* / *Nothing is waiting for review.* |
| a picture with rows | one `MemoryCandidateRow` each, in Descent's own order, in a `ScrollArea` |

The badge is drawn only on `reachable === true`. Stating "0 pending" above *Descent is not
reachable* would have the panel contradict itself in two adjacent lines.

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

Expanded, the row shows the body in a `<pre>` that wraps, then *Why* (`rationale`) and *Index line*
(`indexLine`) where Descent sent them. Every one of those strings is operator-authored free text and
reaches the DOM as a text node — never as markdown and never as markup, however much like markdown
it looks, which is how Descent's own panel draws it too.

Three answers are not a body, and each gets its own sentence: a read that could not be made says
*Descent is not reachable right now.* and is retried on the next expand; a `candidate: null` and a
full read whose `status` is no longer `pending` both say *This memory is no longer pending — it was
reviewed elsewhere.* Those last two are the same news, which is why they share the words. Collapsing
keeps whatever was read — a pending memory's text does not change while it waits, so re-opening is
instant rather than another request.

A refusal, when there is one, sits under the heading: this tab's freshest one if the person just hit
the cap guard, otherwise the copy Descent recorded on the row (which is what every OTHER tab sees).

## The two verbs

**file it** writes the memory to disk. **discard** writes nothing. Both are on every row, both are
disabled while any write is in flight, and each raises one toast:

| The write answered | The toast |
|---|---|
| 2xx on approve | positive — *filed — the memory is on disk* |
| 2xx on reject | positive — *discarded — nothing was written* |
| 422 | warn — *couldn't file that memory*, with Descent's OWN text under it |
| 404 | neutral — *already reviewed elsewhere* |
| 503, or a thrown fetch | warn — *Descent is not reachable.*, with the reason in words |

**A 422 is a verdict, not a fault.** It is Descent's cap guard refusing in plain English and naming
what to trim; the card stays PENDING, the text is held per id for this tab's next paint, and the
refresh that follows also picks up the copy Descent recorded on the row for every other tab. A
generic sentence in its place would leave the person with a pending card and no reason. That text
travels through the proxy untouched — [descent-proxy.md](descent-proxy.md) §"The rules that bite",
rule 8.

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
whole intake lane is HTTP-only and carries no agent seam — no MCP verb, not even a staging one
(Descent GOTCHAS #253). This tab does not widen it. The routes sit behind `authenticateToken` like
every other app route, a soul proposes and only a signed-in person files, and Descent's own routes
at `:7878` were already reachable unauthenticated by any process on this host. What CloudCLI adds is
one bearer-authenticated HTTP path and a pair of buttons; nothing here is callable by an agent.

## Where the shapes live

`MemoryCandidateLean`, `MemoryCandidateFull`, `MemoryPending`, `MemoryCandidateRead` and
`MemoryReviewOutcome` are declared in `src/shared/types.ts` § DESCENT MEMORY INTAKE, mirroring
`server/shared/types.ts` § DESCENT CONTRACTS field for field. The server file is the source and
carries the per-field documentation; a change to either shape belongs in both files at once. The
client calls the four routes through `api.descent.memory` in `src/shared/api.ts` — the reads answer
200 even when Descent is down, so a caller reads the BODY rather than the status, and the writes are
taken from the raw response because they carry Descent's own status through.

Every string is in `src/modules/i18n/locales/en/common.json` under `memory.*`, with the tab's own
label at `tabs.memory`. English only, deliberately: the other ten locales fall back to `en`
(`i18n/config.ts`), which is a readable English word rather than a missing key.

## What is left standing

- **The count pill is `aria-hidden`.** `Tabs` keeps `aria-label={tab.label}` as the accessible name
  so the harness can select by the bare word `Memory` and the label never grows a number, and the
  pill beside it is hidden from assistive technology outright. A screen reader is told the tab
  exists but not how many memories are behind it; the panel's own `N pending` badge is where that
  count is announced.
- **No row is announced when it arrives.** The queue can grow under a person reading it — the panel
  has no live region, so a memory proposed while the tab is open appears silently at the next poll.
- **A read that failed is retried, a read that succeeded is not.** `readFailed` leaves the card
  counting as "never asked", so the next expand tries again; a body already read is kept for the
  panel's life, including across a refresh that re-renders the row.
- **The panel is one flat list, in Descent's order.** No grouping by target or project, no filter,
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
waits again. The zero-count half is produced by answering `GET /api/descent/memory` inside the page
and re-reading through the provider's own visibility path, so the live queue is left exactly as it
was found. Shots are `20-memory-light`, `20-memory-expanded-light`, `20-memory-empty-light`,
`20-memory-390-light` and `20-memory-dark`. See [verification.md](verification.md).
