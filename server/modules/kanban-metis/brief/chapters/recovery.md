# Metis chapter — Recovery: resume · lease lifecycle · idempotency

> **What this is.** The build-recovery model: how an ORPHANED `active` build is
> detected and resumed, the durable build-LEASE that survives a disconnect, and why a
> Metis turn is safe to interrupt and re-run. **Core routes here** at Boot/orient
> step 2 (RESUME FIRST) and BUILD step b — the core carries the orient + the claim;
> this chapter carries the resume + lease + rerun-safety detail.

## Resume on reconnect / rate-limit (READ `list_active_builds` on EVERY orient)

A disconnect, a rate-limit cutoff, or a killed child leaves builds
that were `active` in the store but have no live session driving them. The **build
LEASE** makes them resumable, and the **RESUME read** detects them. Because several
Metis sessions may be alive at once — one per board the driver has running — 
`list_active_builds` shows the `active` cards of THIS board with their raw lease
facts, so this read is also how a session sees which features
OTHER live sessions are building (their leases are FRESH + FOREIGN — never touch them).
Do this at the TOP of every orient (orient step 2), BEFORE claiming any new feature:

1. **Read `list_active_builds(stale_secs=40)`** — every `status='active'` card on this
   board with its raw lease facts (`build_owner`, `lease_age_secs`, `is_stale`,
   `is_mine`, plus the plan-lease four: `plan_owner`, `plan_lease_age_secs`,
   `plan_is_stale`, `plan_is_mine`) and its `id` / `title` / `board` / `priority`.
2. **Classify each active card off its per-row `is_mine` and `is_stale` facts.**
   `is_mine` is the honest ownership verdict, and it compares the card's
   `build_owner` against **this session's own derived owner** — the sixteen hex
   characters this session's id hashes to, computed at launch and handed to the MCP
   child. It is a FUNCTION of the session id, not a token minted in memory, so the
   same session id derives the same owner in any process, after any restart, and on
   the far side of a `--resume`. Read `is_mine` + `is_stale` directly; there is no
   settings row to consult and no per-process token to compare against (this board
   has no `mcp_session_owner` equivalent at all).
   - **MINE-LIVE — LEAVE IT.** `is_mine == true AND not is_stale` → THIS session's own
     in-flight build, kept warm by the heartbeat. Do not touch it; add its footprint to
     the in-flight ledger.
   - **FOREIGN-FRESH — LEAVE IT (another live session's build).** `is_mine == false AND
     not is_stale` → another live Metis is building it RIGHT NOW. Do NOT resume
     it and do NOT claim it (the atomic CAS would refuse anyway). Add its footprint to the
     in-flight ledger so your own pick stays footprint-disjoint from it.
   - **ORPHANED — RESUME IT.** Everything else: `build_owner is null OR is_stale`,
     whoever it is owned by. A stale lease is by definition one nobody is renewing, and
     renewing is the only thing a live build does — so the whole of "not fresh" is the
     resume set. Read the boundary the other way round: **the ONE card you may not
     resume is a lease that is FRESH and owned by ANOTHER session.** That is a live
     session's build, not a hard-stealable mutex; resuming it would double-build an
     overlapping reconnect.
     - **`is_mine == true AND is_stale` is YOUR OWN orphan.** This is the case the
       derived owner exists for: the child died or was reaped, the lease aged out, and
       the SAME session id coming back — a re-adopted session, a driver re-launch with
       the same uuid — reads its own card as `is_mine` and resumes it cleanly. (Descent
       could not do this: it minted a per-process token, so a restarted session could not
       recognise its own build.)
     - **This board has no PARK contract.** There is no `parked` flag on a card here and
       no operator-stop sentinel: a card the operator has deliberately held back is
       expressed by the operator's own hands (a tag, an issue, a card they moved), and the
       mechanical rule you can check is the one the board itself applies —
       `operator-scheduled` keeps a **To-do** card out of `buildable[]` and in
       `awaiting_you[]`, which is never yours to claim. An `active` card is judged on its
       lease facts alone.
3. **Resume an orphan:**
   a. **Reset its stale spinner — keep the bar honest.** If the card's checklist has
      an item stuck `active` (the phase that was mid-build when the build died),
      set it back to `pending` (`set_checklist_item(<that k-N>, 'pending')`) — an
      `active` spinner with no live builder is a lie. Items already `done` stay
      `done` (those phases really shipped — recorded as `done` on the card's checklist).
   b. **Reconstruct its footprint** by re-reading the `Footprint:` line from the
      card's `plan` file on disk. Add it to the in-flight ledger NOW — so a resumed build
      never has its files double-claimed by a feature THIS session is about to claim.
   c. **Re-claim it (atomic CAS) and build it SOLO INLINE** via `Skill(execute)` on its
      `~/.claude/plans/pm-<slug>.plan.md`. First `set_status(id,'active')` to re-claim —
      this is the atomic compare-and-set: a stale/orphaned lease re-stamps to THIS
      session's owner, but if another session has SINCE picked it up (its lease went FRESH
      between your read and now), the CAS refuses — the answer comes back
      `buildLease: false` — in which case it is not yours to resume,
      so skip it. Once claimed, the inline `/execute` is rerun-safe: it reads the **card's
      BUILD CHECKLIST item states** (the build's progress + resume substrate, NOT the
      `/execute` pipeline marker and NOT plan-file `✅ SHIPPED` ship-logs — those are the
      legacy inline `/execute` flow's substrate; a Metis build writes neither), SKIPS every
      `done` phase, and continues at the FIRST `pending` phase (idempotent — it never
      re-ships). Before re-running `Skill(execute)`, read the first pending/active item's
      `note` (the mid-phase breadcrumb from step c) to resume WITHIN that phase, not from its top.
      Do NOT author a new plan or restart from Phase 1. **First reconcile the
      operator's answers** (BUILD step 0) in case they answered while the build was orphaned.
      (One feature per orient still holds — resuming an orphan IS this session's one build
      for the pass.)
4. **Establish the disjoint-file ledger from ALL in-flight footprints (yours, other live
   sessions', and any you just resumed) BEFORE claiming any NEW feature.** Comparing a
   candidate's footprint against this full ledger (chapter **parallelism.md**) is what keeps
   a resume — or another session's build — from being clobbered by your fresh claim landing
   on the same files. Nothing on this board checks that comparison for you; the discipline
   is yours.

A guard the plan-file-missing case shares: if an orphan's `plan` file no longer
exists on disk, do NOT silently drop it — `file_issue(id, 'plan file missing at
<path> — re-plan needed')` (reopens it to To do) and name it in the report, exactly
as step a of the BUILD ladder does for a fresh build.

---

## Lease lifecycle (the durable lock that survives a disconnect)

- **Claiming a build = the CLAIM half of `set_status(id, 'active')` — an ATOMIC
  compare-and-set.** The tool moves the card to `active` and then claims, and it is the
  claim that is the compare-and-set: the
  store stamps `build_lease_at` = now + `build_owner` = THIS session's derived owner
  in one guarded UPDATE (you do not write the lease yourself — the store does it on the
  transition), but ONLY if the card is claimable (unclaimed / mine / stale /
  null-lease / corrupt-lease). If a FOREIGN, still-FRESH lease is held — another live Metis
  is building it — the guarded UPDATE matches zero rows and the call answers
  **`{card, buildLease: false}` with a 200**, the lease left exactly as it was. (The lane
  move in front of it has already happened; with a foreign-FRESH lease the holder had already
  put the card in `active`, so the move changed nothing. Leave it alone.)
  **A refusal is not an error, so nothing throws and nothing turns red: the verdict is a
  FIELD you must read.** This is the cross-session lock that lets several solo Metis
  sessions run without double-claiming:
  the loser of a race re-evaluates against the winner's just-committed row, misses, and
  picks another feature (the single guarded UPDATE that closes the decide-then-write
  window is why two sessions reaching for the same free card cannot both be told they
  have it).
- **The MCP heartbeat refreshes the lease** (`build_lease_at` re-stamped to now) every
  **10s**, and ONLY for rows whose `build_owner` is this session's owner
  (the correctness boundary: a resumed session must NOT re-stamp a
  dead session's stale lease, or the orphan signal vanishes before it is read). This
  is automatic; Metis does not call it. It lives in the MCP process rather than in the
  driver because the lease verbs are compare-and-set on the OWNER — a refresh sent by a
  process that is not acting as that owner would defeat the compare.
- **The board's staleness window is 40 seconds** — `KANBAN_LEASE_STALE_SECONDS`, four
  missed 10s heartbeats. A lease un-refreshed for longer than that reads `is_stale`.
- **`done` / `file_issue` (and any move off `active`) clears the lease** — both
  `build_lease_at` and `build_owner` go NULL.
  A cleared lease is the correct "not building" state.
- **NEVER resume or steal a feature whose lease is FRESH + owned by ANOTHER live
  session** (`is_mine == false AND not is_stale`). The lease is advisory-with-
  staleness, not a hard mutex: stealing a fresh foreign lease double-builds an
  overlapping reconnect. Only orphans (`build_owner is null OR is_stale`) resume.
- **The owner is DERIVED from the session id, never minted.** That is the one property
  this board changed from Descent on purpose. A minted token lives only in the process
  that minted it, so a resumed or re-adopted session would come back unable to refresh
  the leases it already holds and would be reaped by its own staleness rule. A derived
  owner is the same sixteen hex characters every time that session id is seen, by any
  process, after any restart — so a crashed-then-restarted Metis picks her own work back
  up as **her own**, and the driver's re-adoption of a session is a continuation rather
  than a new claimant.
- **The lease tracks THIS session's liveness** (its 10s heartbeat refresh). Because the
  build runs INLINE, the session is alive for the whole build by construction — the
  `Skill(execute)` call IS the session working — so the heartbeat keeps the lease fresh
  throughout. If the session is KILLED mid-build (a crash, a usage-limit cutoff), the
  heartbeat stops, the lease goes stale (40s), and a later orient (this session restarted,
  or ANOTHER session) correctly reads it as ORPHANED → resumable. That is the intended
  recovery path. After the build completes, the session re-orients and claims the next
  disjoint feature; at QUIESCENCE it simply ends the turn (it does NOT idle or poll) — and a
  session with no in-flight build that exits leaks nothing (its lease was already cleared
  at `done`/`file_issue`).

---

## Idempotent / rerun-safe

A Metis turn is safe to interrupt and re-run — including a usage-limit cutoff
mid-build. Durable state lives in FOUR places and re-orienting reconciles from them:

- **The build LEASE in the board's store** (the card's lease stamp + owner) +
  the **RESUME read** `list_active_builds` — these are how ANY session detects which
  `active` builds are orphaned (resumable) vs MINE-LIVE / FOREIGN-FRESH (leave alone).
  This is the durable, cross-session lock (atomic CAS) that survives a
  disconnect/rate-limit. See §"Resume on reconnect / rate-limit" + §"Lease lifecycle".
- **The card's BUILD CHECKLIST in the board's store** — the per-phase progress + RESUME
  substrate for a
  Metis build. Metis marks each phase `active`→`done` as the inline build ships it
  (chapter **parallelism.md**), so a resumed build reads the checklist's done/pending item states,
  SKIPS every `done` phase, and continues at the FIRST `pending` one — no double-ship.
  **Resuming an interrupted build is just re-claiming the feature (atomic CAS) and
  re-running `Skill(execute)` on its plan** — do NOT author a
  new plan or restart from Phase 1; the inline pipeline is rerun-safe and resumes at the
  first pending phase. (A Metis build records progress on the CHECKLIST, not by writing
  plan-file `✅ SHIPPED` ship-logs — so Metis never pre-stamps a ship-log and the plan's
  ship-log guard is never tripped on the plan; the checklist is the honest progress mirror.)
- **The card's lane in the board's store** — a card the operator moved (answered + approved, or
  reopened by a filed issue) is re-read fresh on EVERY orient. A feature
  whose operator files an issue MID-BUILD yanks back to **To do**; Metis notices the
  lane change on her next re-orient and stops greening that build rather than racing
  the operator.
- **The plan file on disk** — `attach_plan` is idempotent on path; re-attaching the
  same plan just re-caches the body. A card already in **Open questions** is skipped
  by the ladder's step (1) filter (it only walks `to_plan[]`), so re-orienting
  never re-posts questions on a card the operator is already answering.

**The PLAN lease is the sibling lock, and it has no refresh verb.** `claim_plan` IS its
re-stamp — the store grants a plan lease that is free, stale, or already yours, so an owner
re-claiming its own lease simply renews it and a foreign one is refused with
`granted: false` rather than stolen. Its three lifecycle doors all release it:
`attach_plan`, `post_design_questions` and `file_issue` — because those three are where
planning ENDS, and a claim that outlived its planning would pin the card to an owner who has
walked away. The heartbeat re-stamps a plan lease through the same claim verb, every 10s,
for the same reason the build lease is re-stamped there and not in the driver.

**`/execute` stale-marker recovery (in play for a Metis build too).** Because a Metis
build runs `Skill(execute)` INLINE, the `/execute` machinery is in play — including
its pipeline marker (`~/.claude/state/pipeline_active_<session>.txt`). A Metis build's
OWN per-phase resume substrate is still the card's CHECKLIST (above), but if a crashed
inline `/execute` leaves a stale pipeline marker that wedges the next turn, the hook
SELF-HEALS it — the Stop hook auto-clears a marker that is PROVABLY dead (no soul dispatched
AND no block within `DESCENT_PIPELINE_HEAL_MINS`, default 6h; a live run is never healed).
The manual `rm ~/.claude/state/pipeline_active_<session_id>.txt` stays the fallback (the block
message prints the exact filename). Everything else reconciles from the
checklist + the card lanes + the lease.
