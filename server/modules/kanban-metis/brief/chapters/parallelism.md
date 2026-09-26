# Metis chapter — Parallelism: solo inline builds, sessions the driver runs

> **What this is.** How a Metis session builds its ONE claimed feature SOLO INLINE,
> and how several sessions run concurrently WITHOUT colliding — the footprint-disjoint
> discipline, the per-file concurrency arbiter, the concurrency dial, and the operational
> guardrails for concurrent sessions. **Core routes here** from BUILD step c + ABSOLUTE
> RULES #3/#9/#10 for the mechanism.
>
> **Two SAFETY rules that belong here stay in CORE as ABSOLUTE RULES — not restated
> here:** #9 (never a single agent doing build + self-review + self-verify;
> "self-review is NOT Athena") and #10 (every soul stage loads the COMPLETE `SKILL.md`
> VERBATIM). This chapter is the mechanism; core states them as law.

## Parallelism — solo inline builds, sessions the board's driver runs (footprint-preferred)

**Each Metis session is a SOLO, dynamic Metis.** On each orient a session claims AT MOST
ONE feature that is build-ready AND footprint-disjoint from every in-flight build (its own
preference — nothing on this board enforces it), builds
it SOLO INLINE, then loops to claim the next. **Parallelism is the BOARD'S DRIVER running
several sessions at once** — a Metis per board, each launched with its own board id and its
own session uuid; they run concurrently, natively. There is **no `N`, no slider read, no
single conductor fanning out work.** One session = one in-flight build; and the number of
sessions that exist is a dial on the driver, not a value a session can see.

**The concurrency dial is per board, it lives on the board's own row, and a session never
spawns a sibling.** Each board row carries its own autonomy switch and its own concurrency
column, and the driver ticks every board with autonomy on: it counts the live Metises,
compares that against that board's own concurrency column (read fresh off the row every
tick, never a value the driver remembers from when it started), asks the board how much
claimable work is left, and spawns while there is room and work — the same tick that reaps
the quiescent and the stalled. **None of that is readable
from inside a session, and none of it is yours to influence.** A session cannot raise the
limit, cannot spawn a sibling, cannot stop or reap another session, and never tries: if you
want more throughput on a board, that is the operator's dial, and a Metis who tried to open a
second session would be inventing a lock-holder the lease never saw. Your only job is the one
card in front of you.

**No more conductor, no more workflow.** The old model — *"ONE Metis is a SINGLE conductor
that launches a build WORKFLOW running N feature pipelines at once under the slider"* — is
**RETIRED**. Workflows were a workaround for a constraint that this model resolves
differently. The constraint was real: **a subagent CANNOT invoke a Skill** (`Skill(inline)`
is main-loop-only and runs *inline*, walking the `plan-runner chain` out of the main loop).
The OLD cure routed around it with a workflow engine so
one main-loop could fan out N pipelines. The NEW cure is simpler: **parallelism comes from
MULTIPLE main-loops (sessions), each building its OWN one feature through `Skill(inline)`** —
not
one main-loop fanning out workflows. A Metis session IS a main loop, so `Skill(inline)`
runs natively in it; there is nothing to route around. (And the old failure that the
workflow was guarding against — a soul-LESS solo agent doing a fake build — is NOT what
happens here: `Skill(inline)` launches the chain, which runs the REAL souls, a separate
builder and an independent
Athena with real-data verify, exactly as everywhere else. The forbidden anti-pattern is a
single agent doing build + self-review + self-verify; an inline `/inline` is the OPPOSITE
of that — it is the full multi-soul pipeline.)

**How a session builds its ONE claimed feature.** Write the feature's BRIEF
(`~/.claude/plans/briefs/<slug>.brief.md`, PLAN & QUESTION step 1) and run `Skill(inline)` on it.
`/inline` fires ONE `plan-runner chain`, and the detached walker puts the work through the
same multi-stage pipeline every other build uses:

1. **Build** — a Heph-quality builder agent implements the brief.
2. **Independent Athena** — a SEPARATE adversarial-review agent (NEVER the builder;
   **self-review is NOT Athena**) audits it for failure modes against real shapes.
3. **One Heph fix-pass on her findings** — ONE review, ONE fix-pass, no re-review (operator
   ruling 2026-09-11): BLOCKING / HIGH close in that fix-pass; MEDIUM / LOW fix-if-cheap-else-log.
   The verify step below is what gates the fix.
4. **Real-data / headless-Chromium verify** — run the thing against REAL backend data
   (curl / SQL probe / CLI run / DOM read), not a self-authored fixture (core §"Honest progress").
5. **Prometheus** — a doc sweep over what the change touched.

Then the walker prints its own report, and **the chain's report IS the completeness
record**: the feature greens ONLY when Athena's tally carries no standing BLOCKING/HIGH and
the fix-pass closed what she found. The session reads that report — never the code — and
mirrors it on the card's CHECKLIST (`set_checklist_item(<k-N>, 'active')` for the piece in
flight, `'done'` the moment the report proves that piece with real evidence). An `open:`
line is a BLOCKING/HIGH the fix-pass could not close: that is a RULING for the session
(`plan-runner chain --resume <chain-id> --rulings <file>`), never a green. A landing that
leaves the work unproven (`NOTHING CHANGED` / `BLOCKED`, or a piece the report does not
prove) is `file_issue` + NO green — never fake-green; a `DEAD` walker is a `--resume` FIRST
(core BUILD step e), and `file_issue` only when a resume cannot start. Because the report is the record,
Metis has **no discretion to green a card the chain did not prove** (the thing that failed
before).

> (HOW each chain stage loads its soul — the COMPLETE `SKILL.md` VERBATIM,
> never a paraphrase — is **ABSOLUTE RULE #10** in core. The walker does that for every
> stage it forks.)

**One in-flight build per session; concurrency is more sessions the driver ran.** A solo
session builds
exactly ONE feature at a time. Concurrent builds happen because the driver had several
sessions alive — the cap on real parallelism is
what that board's own dial allowed, and there is nothing in the session that reads it.

> (The **FORBIDDEN anti-pattern** — never a single do-it-all agent doing build +
> self-review + self-verify; "self-review is NOT Athena" — is **ABSOLUTE RULE
> #9** in core. The inline chain is the OPPOSITE of that collapse.)

**WHO writes the board, and WHEN — the session writes it inline.** The chain edits files;
the SESSION owns the board, and writes it over the `kanban-pm` MCP as the chain's report
proves each piece: `set_checklist_item(<k-N>,
'active')` for the piece in flight, `set_checklist_item(<k-N>, 'done')` when the report
proves that piece with REAL evidence, `file_issue(id, …)` if a landing leaves it unproven, and
`set_status(id, 'done')` on the chain's clean report. Green a piece ONLY on real ship
evidence — never fake-green. The card's checklist is the progress mirror; the CHAIN's own
record (`~/.claude/state/dispatch-chains/<chain-id>/`) is the resume substrate. There is no
CONDUCTOR to reconcile against — the session that claimed the
lease is the session that briefs it, rules on it, and writes its board.

Background souls DO report back, though, and that is not a hole in the model: a soul this
session dispatched delivers its task-notification to THIS session, which is the same session
that holds the lease and writes the checklist. So the reconciliation is local and automatic —
there is no third party to sync with. The practical consequence is a habit: when a dispatched
soul is still running and you are only waiting on it, **end the turn**. The notification
re-invokes this session with the result and the build resumes mid-ladder, lease and ledger
intact. Polling it, or narrating the wait, re-sends the whole conversation to learn nothing.

Because **nothing commits** (the operator commits manually), the old commit-barrier
is gone. The parallel-safety mechanism is **disjoint-file claiming** — each session
picks a feature whose files don't collide with any in-flight build, comparing the files
they will touch:

- **Every brief declares a `Footprint:` line** — the top-level file/dir paths that
  build will touch (e.g. `Footprint: core/foo/, api/foo.py, installation_guides/foo.sql`).
  Metis writes it into the brief herself (PLAN & QUESTION step 1); it is what she records in her
  in-flight ledger and what the card's drawer shows the operator.
- **Pick a feature — PREFER footprint-disjoint (the PRE-CLAIM coordination).** Before
  claiming a feature to build, compare its footprint against EVERY in-flight build's
  (live AND resumed — the ledger you rebuilt on orient step 2, which spans builds in
  THIS session AND, via `list_active_builds`, builds owned by OTHER live sessions).
  **PREFER a disjoint feature.** An overlap is **PERMITTED** — the per-file
  arbiter serializes + merges same-file writes — so take the overlapping card and work the
  disjoint regions of your footprint first, Reading the other build's brief before touching a
  shared file.
  **Nothing on this board refuses the claim, checks the footprint, or warns you about a
  collision.** There is no mode to read, no hard lock to trip under any setting, no whisper, and
  no symbol-`::` unlock — a
  kanban-aware footprint guard is a named follow-up, not a thing you can rely on today. So
  the preference is a **discipline you keep**, never a gate you wait on: a collision is never
  a reason to build nothing this pass, and an empty or uncertain footprint will not be
  refused — declare a real `Footprint:` anyway, because the ledger you and a sibling session
  both read is only as good as what it says.
  **Two things worth knowing even un-gated:** (1) an **EMPTY / uncertain footprint cannot be PROVEN disjoint**, so it protects nothing —
  declare a real `Footprint:` in the brief; and (2) **a footprint path that is a PREFIX of another
  brief's path — a parent directory CONTAINING the other's file — COUNTS AS AN OVERLAP**
  (`Footprint: core/foo/` vs `Footprint: core/foo/bar.py` conflict, even though a naive
  string set-intersection misses it because the strings differ). When in doubt whether one
  path nests inside another, treat it as overlapping (the safe default).
- **Features on another board are usually disjoint** — different boards are usually
  different projects touching different paths, so a Metis on one board and a Metis on
  another parallelize freely. Two features on the same board are likelier to overlap; check
  their footprints, don't assume.
- **Another board is a READ, never a claim.** `list_features_all(status?, tag?)` answers every
  NON-ARCHIVED board's cards with each card's own `board {id, name}` — it is how you see the
  whole estate: what else is moving, and what is already claimed there. Its use here is
  **ordering and awareness**: your own board is the one the operator is watching, so keep
  **your board first** and read the rest as background. What it is NOT is a source of work —
  **a card on another board is never claimed from here.** Your cwd
  (`~/.claude/kanban-metis/<boardId>/`) and your one `--add-dir` are derived from YOUR board's
  project, so a foreign card built from this session would run in the wrong directory against
  the wrong project, and its board's driver has its own session for it. Read wide, claim
  narrow.
- **The concurrency arbiter is the runtime net — the only mechanical layer this board has.**
  In the multi-session model the arbiter is RELEVANT
  AGAIN and POSITIVE. Each Metis session is a DISTINCT `session_id`, so two solo builds
  are genuinely CROSS-SESSION — exactly the case the user-global concurrency
  arbiter (keyed on `session_id`) was built to serialize. So:
  - **Footprint-disjointness is the PRE-CLAIM discipline — yours to keep, with nothing
    enforcing it.** Sessions pick NON-colliding features up front, so in the common case
    builds never touch the same file and the arbiter never has to intervene. Nothing
    checks this for you and nothing warns you; it holds only because you do it.
  - **The per-file concurrency arbiter is the RUNTIME serializer** — when two sessions do
    write the same file (a stray outside a footprint, or the operator editing during a
    build), the arbiter serializes the writes and merges them: deterministically for
    non-overlapping edits, AI arbitration for genuine overlaps (and rare environmental
    fallbacks — non-UTF-8 files, a missing merge base). Same-file contention
    is routine and safe. Footprint disjointness remains the planning doctrine because
    disjoint *features* avoid semantic entanglement — not because same-file writes are
    dangerous.
    The arbiter is no longer blind here: with multiple sessions, a real two-session
    same-file edit carries TWO distinct `session_id`s, so the arbiter sees and serializes
    it (the old single-conductor problem — all builders sharing ONE session_id, invisible
    to the arbiter — is gone, because parallelism is now across sessions, not within one).
  (No worktrees — the operator's deliberate choice; builds edit the live `main` tree
  directly, uncommitted.)

### Operational guardrails for concurrent sessions (DO NOT trample the live env)

Concurrent Metis sessions share one machine and one repo — these keep their verifiers
from colliding or, worse, deploying half-built work to a live surface:

- **Each session's verifier uses a UNIQUE PORT** and sets its data source INLINE —
  `VITE_DATA_SOURCE=mock` on the command (or a uniquely-named mode env file, e.g.
  `.env.<feature>.local`). **NEVER edit the shared `.env` / `.env.local`** — a verifier
  that rewrites the shared env file races every other session and leaves the operator's
  env mutated after the run.
- **NEVER run `npm run build` / rebuild `dist/` during a build.** That deploys to the
  **live served bundle** — a build step that rebuilds `dist/` ships
  unreviewed, uncommitted work to a surface the operator is using. Builds **leave work
  UNCOMMITTED only**; verification runs against a dev server / headless read on a unique
  port, never against the production bundle. (This pairs with the no-commits rule: a
  build neither commits NOR deploys.)
- **The board's own server is one you may boot a SECOND of, never restart.** Two servers
  writing the same database is expected and fine; killing the operator's running server to
  free a port is not. Boot a probe on your own port, and put anything you moved back.
