# Metis chapter — The pm-<slug>.plan.md template + pre-build self-check

> **What this is.** The EXACT hook-classifiable plan shape every `pm-<slug>.plan.md`
> must take, plus the self-check snippet that runs the plan through the real classifier
> BEFORE `attach_plan`/build. **Core routes here** at PLAN & QUESTION step 1 — Odysseus reads it
> live while authoring; Metis reads it to VERIFY what he wrote before `attach_plan`.
>
> **ABSOLUTE RULES #7 and #8 remain BINDING from core** — this chapter shows HOW to
> satisfy them; core states them as law. #7: gate prose (`DEFERRED`/`AWAITING`) lives
> in the plan BODY, never on or adjacent to a phase heading. #8: no phase-shaped prose
> inside code fences. Reword any title carrying a reserved keyword out of every phase
> heading.
>
> **The plan SHAPE is unchanged by the board** — this is the same format-v2 plan the same
> runner walks, authored to the same classifier. Only the card it hangs off is this board's.

## The pm-<slug>.plan.md template (HARDCODE this — the hook MUST classify it)

`/execute`'s Stop-hook (`auto_execute_plan.py`) classifies a phase **SHIPPED** iff
the heading line + its next ~5 lines contain a `✅` AND the word `SHIPPED`
(case-insensitive) AND a `YYYY-MM-DD` date. A phase header that doesn't match
`_PHASE_HEADING_RE` (`### Phase N — Title` or `**Phase N**`) is INVISIBLE to the
gate. Author every `pm-<slug>.plan.md` to this exact shape:

```md
# pm-<slug> — <Feature title>     <!-- <slug> = kebab-case of the card TITLE, no id -->

> Kanban board feature `<cardId>`. Built by Metis → solo inline `Skill(execute)`.
> Each phase below maps to a slice of this feature's scope; the inline build ships them all.

Footprint: <top-level file/dir paths this build touches, comma-separated — e.g.
core/foo/, api/foo.py, installation_guides/foo.sql>

## Scope → phase map
- "<plain-English scope slice 1>" → Phase 1
- "<plain-English scope slice 2>" → Phase 2
- ...

## Locked rules / constraints
<the target-repo locked decisions + the ABSOLUTE RULES above (no tests, no
branches, NO commits / NO push, NO dist/ rebuild — the inline build builds +
verifies only and leaves the work uncommitted on main for the operator; honest
progress on real data).>

### Phase 1 — <neutral words for the WORK this phase does>
Implements: "<scope slice 1>".
Depends on: none
<concrete scope: files to touch, the behavior to ship, the verification that
proves THIS slice with REAL data (run it / curl it / query it / read output) —
NEVER a test file. Any gate prose — "awaiting operator approval", a deferred
dependency — goes HERE, below this Implements line, never on the heading or its
neighbors.>

### Phase 2 — <neutral words for the WORK this phase does>
Implements: "<scope slice 2>".
Depends on: Phase 1
<scope + real-data verification for THIS slice>

<!-- LEGACY inline /execute ship-log shape (kept here so the plan stays classifier-
compatible). The /execute Stop-hook reads this ✅ + SHIPPED + date line to mark a phase
done — e.g.:
### Phase 1 — <title>  ✅ SHIPPED 2026-06-17
- pipeline invocation: <tool-call id>
- verification: <one-line real-data evidence>
A Metis inline build does NOT write this ship-log — it greens the card's CHECKLIST per
phase instead (chapter **parallelism.md** step 5); the checklist is the inline build's progress +
resume substrate. Either way, Metis NEVER pre-stamps a ✅ SHIPPED line on an unbuilt
phase. -->
```

Rules for the template:

- **The `Footprint:` line lives in the DOC HEADER (below the blockquote, ABOVE the
  Scope map) — never inside a phase body.** It is the disjoint-file ledger's input (the
  top-level paths the build touches). Placing it in the header keeps it FAR from any
  `### Phase N` heading, so it lands OUTSIDE every phase's defer-window AND outside
  the SHIPPED-detection window (heading + next 5 lines): it is not phase-shaped (it
  never matches `_PHASE_HEADING_RE`) and carries no `DEFERRED`/`AWAITING` keyword, so
  the hook is completely blind to it — it can never defer a phase or be miscounted as
  one. Keep the word "Footprint" off any phase heading/neighbor line regardless. On a
  RESUME, Metis reconstructs the in-flight footprint by re-reading THIS line from the
  plan (chapter **recovery.md** §"Resume on reconnect / rate-limit").
- **Declare FILES, not symbols — the `PATH::SYMBOL` narrowing does not reach this board.**
  Descent let a Footprint entry narrow from a whole file to a single symbol with a `::`
  suffix (`config/parser_features.py::flag_a`, `eis_backend/routes/jobs.py::get_job_detail`),
  so that two builds on the SAME file under DISTINCT symbols stopped colliding. That is a
  property of Descent's footprint guard, which keys on Descent's own `set_status` tool name
  and **does not fire for a `kanban-pm` session** (chapter **parallelism.md**) — so on this
  board a `::SYMBOL` buys nothing at all: nothing reads the footprint, so a symbol unlocks no
  parallelism and hides no collision either way. **Write plain file/dir paths**
  (`core/foo/, api/foo.py, installation_guides/foo.sql`). The broad FILE claim is the safe
  over-claim — it states more of what you touch, and the ledger you and a sibling session both
  read is built from exactly what you wrote there. Guard 1 still lints the line at
  plan-write time (an empty `foo.py::` with nothing after the `::` is REJECTED), so write the
  file and move on.
- **The `Depends on:` line sits directly beneath `Implements:`** — `none` or phase ids
  (`Depends on: Phase 1, Phase 3`), never a word. It declares the phase graph (Odysseus
  doctrine §8); the classifier's defer-window still reads the `Implements:` line first,
  so it changes no verdict. A pm plan declares waves but is never split into files.
- **Phase headers are `### Phase N — <neutral phase-work descriptor>`** (markdown-
  header form). The bold form `**Phase N**` also classifies — pick ONE shape and
  keep it consistent. The header describes the WORK of the phase, NOT the feature
  name — **never blindly echo the feature title into a phase header.** The feature
  title lives in the doc title (`# pm-<slug> — <title>`) and the Scope → phase map,
  both OUTSIDE any defer-window.
- **`DEFERRED` / `AWAITING` are hook-RESERVED keywords (case-insensitive).** The
  hook's defer-window shifts with blank-line padding (an off-by-one in its
  heading-line index): with a blank line above a heading it scans the heading line;
  with no blank line it scans the heading line + the first body line. The
  conservative truth — **keep both keywords out of the heading, the line above it,
  AND the first non-blank body line.** Two ways this bites:
  - A feature titled e.g. "Deferred maintenance dashboard" / "Awaiting carrier
    confirmation" MUST be reworded out of the phase headers. Paste the raw title
    into every header and ALL phases classify DEFERRED → `unshipped == 0` → the build
    ships NOTHING. The title is safe in the doc title + scope map only.
  - Gate prose ("awaiting operator approval", a deferred dependency) goes BELOW the
    `Implements:` line — never as a phase's first body line, where `AWAITING` would
    defer just that one phase (a partial-skip that slips past the `n >= 1` check).
- **Never pre-stamp a `✅ SHIPPED` line** — that makes the legacy `/execute` hook skip
  an unbuilt phase, and an unbuilt `✅ SHIPPED` is a lie regardless. A Metis inline
  build records progress on the card's CHECKLIST (per phase, on real verify evidence —
  chapter **parallelism.md** step 5), NOT by writing a plan-file ship-log. The plan file is the
  build's read-only CONTRACT: pass each stage the brief and instruct the stage agents
  **"PLAN FILE: <path> — DO NOT edit it"** (mirroring `/execute`'s doc-pass split) — so
  NO stage agent writes the plan file; the build's per-phase ship signal is the
  `set_checklist_item(<k-N>, 'done')` MCP call, not a plan-file edit.
- **Verification is real-data, never a test file** (ABSOLUTE RULE #1). Every
  phase's verification line is a thing to RUN against reality (curl, SQL probe, CLI
  run, headless-Chromium read), not a `test_*.py`.
- **Stamping a line-initial `BUILD-TIMING GATE` in a plan MUST be paired with the
  `operator-scheduled` tag on the card.** The tag is what carries the operator's intent
  across the lane: the board buckets any `todo` card carrying it into `awaiting_you`
  rather than `buildable`/`to_plan`, and `awaiting_you` is never yours to claim — so the
  tag alone is what keeps a scheduled card out of the ladder. (The driver's own claimable
  count reads status, not tags, so it may still spawn a session for a board whose only
  todo cards are `operator-scheduled`; that session orients, finds nothing actionable, and
  ends its turn. Harmless, and the reason the tag is not a substitute for a lane move.)


---

## Self-check the plan against the hook BEFORE the build

Before `attach_plan` and before the inline build, run the authored plan
through `auto_execute_plan.py`'s real classifier — the SAME phase classifier the
write-time Guard 1 mirrors and the SAME one `/execute` walks to enumerate the unshipped
phases it must build (the checklist is derived 1:1 from these same `### Phase
N` headings, step 2a). It does TWO things and ABORTS with a NAMED diagnostic (never a bare
opaque assert) on either failure — never attach or build a plan whose phases the classifier
(and thus Guard 1) will silently skip:

```bash
python3 - <<'PY'
import os, re, sys
sys.path.insert(0, os.path.expanduser('~/.claude/hooks'))
import auto_execute_plan as h
text = open(os.path.expanduser('~/.claude/plans/pm-<slug>.plan.md')).read()

# Check 1 — the hook sees at least one UNSHIPPED phase (regex hit + not deferred).
n, names = h._count_unshipped_phases(text)
print('unshipped phases:', n, names)
assert n >= 1, (
    'SELF-CHECK ABORT: hook sees ZERO unshipped phases — fix the phase headers '
    '(must match "### Phase N — Title") before firing /execute')

# Check 2 — no hook-reserved keyword in any phase defer-window. The hook derives a
# phase's heading-line index from count("\n", 0, match.start()); with a blank line
# above a heading that index lands on the BLANK line (an off-by-one), so the EXACT
# line the classifier inspects SHIFTS with blank-line padding (empirically: blank-
# above → it scans the heading line; no-blank → it scans heading + first body line).
# Rather than chase the exact line, guard a CONSERVATIVE SUPERSET — the line ABOVE
# the heading, the heading itself, AND the first non-blank BODY line — so the check
# catches every placement the classifier defers on today AND survives a future
# off-by-one fix. Same regex + fence-stripping as the hook so phase detection matches.
stripped = h._strip_code_fences(text)
lines = stripped.splitlines()
reserved = ('DEFERRED', 'AWAITING')
offenders = []
for m in h._PHASE_HEADING_RE.finditer(stripped):
    i = stripped.count('\n', 0, m.start())          # hook's heading-line index
    # Skip forward past any blank the off-by-one landed on to the TRUE heading line,
    # so the body scan starts after the real heading.
    hi = i
    while hi < len(lines) and not lines[hi].strip():
        hi += 1
    above = lines[i - 1] if i - 1 >= 0 else ''       # line above (off-by-one slot)
    heading = lines[hi] if hi < len(lines) else ''   # the real heading line
    body1 = ''
    for ln in lines[hi + 1:hi + 6]:                  # first non-blank body line
        if ln.strip():
            body1 = ln
            break
    window = (above + '\n' + heading + '\n' + body1).upper()
    hit = next((kw for kw in reserved if kw in window), None)
    if hit:
        offenders.append((m.group(1), hit, heading.strip()))
assert not offenders, (
    'SELF-CHECK ABORT: phase header / surrounding line contains hook-reserved '
    'keyword DEFERRED/AWAITING — reword before firing. Offenders: '
    + '; '.join(f'Phase {pid} [{kw}]: {hd!r}' for pid, kw, hd in offenders))
print('self-check OK: no reserved keyword near any phase heading')
PY
```

The `assert not offenders` message NAMES the offending phase id, the keyword, and the
heading text so the fix is obvious: reword the phase descriptor (neutral words
for the phase's WORK) or move gate prose below the `Implements:` line. Do NOT
`attach_plan` or start the inline build until BOTH checks pass.
