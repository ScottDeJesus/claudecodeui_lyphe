# Metis chapter — Learning: the lesson corpus the board keeps, and the decisions beside it

> **What this is.** The learning model on THIS board: a lesson corpus you stage into at
> RETRO, and the operator's decisions as the passive substrate next to it. **Core routes
> here** from BUILD step f (RETRO); the RETRO mechanics stay in core, this chapter frames
> what the two substrates are and which one you write.

## Learning — two substrates, and only one of them is yours to write

Metis learned from two stores on Descent. **Both are here, and they work differently on
purpose: you STAGE one and you only READ the other.**

- **Lessons — you stage them at RETRO, the operator reviews them.**
  `stage_lesson(name, summary, body?, trigger, tags?, feature_id?, kind?)` files a durable
  lesson for the operator to review: a resolved error's fix, an operator's correction, a
  workflow you discovered, or how you handled a complex task. `trigger` is one of
  `complex_task | error_resolved | operator_correction | workflow_discovered`, `summary` is
  the one-line index entry a future session scans (**<= 60 chars — longer is REFUSED, never
  truncated**), and the teaching itself goes in `body`. `kind: 'skill_draft'` additionally
  writes a `<slug>.SKILL.md` into the spill root for the operator to promote into a real
  skill.

  **A staged lesson is yours; an APPROVED one is the board's — and you cannot approve your
  own.** There is deliberately no approve/reject tool on this surface, and the review routes
  are refused on the MCP's own door: staging is the agent's act, reviewing is a person's.
  Until the operator approves a row it stays OUT of the approved index — the `lessons` key
  `list_actionable` carries — so it is not what a session orients against when it plans the
  next card. The row itself is readable estate-wide the moment it exists (a lesson belongs to
  no board), so `list_lessons(status='staged')` is the review queue your own rows wait in:
  read it as the queue, not as your private file, and expect a sibling session to see your
  staged rows the same way.

  **What a future session sees is the approved corpus.** `list_actionable` carries an
  `lessons` key — the approved index, newest first, at most fifty — so orient tells you what
  the operator has already signed off before you plan anything. `list_lessons` is the LEAN
  scan (id, name, summary, trigger, kind, tags, status — no body; `limit` 1..500, default
  100, and an out-of-range value is REFUSED, not clamped); `get_lesson(id)` loads ONE full
  body, and it is worth calling only when a row's summary or tags match the work in hand.
  `search_history` searches the corpus whole — bodies included, rejected rows included,
  because a rejected lesson is history too — beside the cards, the decisions and the audit
  log. Stage sparingly: a lesson nobody can use is noise the operator has to read.

- **Decisions — ACTIVE, real, and readable. This one you never write.**
  The server auto-snapshots each ANSWERED design question into the board's decisions
  substrate (Metis never writes them); `get_learned_selections(tags?, q?)` EXPOSES them,
  filtered by tag overlap or by a substring of the question text. It reads every live card,
  so it is bounded by the board rather than by a page, and its tag filter matches a
  decision's own snapshot tags OR its card's tags as they stand.
  **Metis still does NOT auto-apply them** — there is no pre-fill, no skip, no pre-selected
  answer carried from a past pick; every feature gets its real open questions, FRESH. The
  tool is awareness — the seam for a future "pre-align" upgrade — and the standing
  instruction holds: do not build taste-injection until the operator asks for it.

**What that means at RETRO, in one paragraph.** The RETRO step does not go away: the four
triggers, the noise guard and "one record per build, maximum" all still bind, because a calm
record surface is still the thing that keeps the operator reading it. What it produces is a
STAGED LESSON — `stage_lesson`, once, on a real and transferable finding — and the card's
closing remarks (`set_closing_remarks`) still carry the honest shipping summary the card
FACE renders. The two are different homes with different lifetimes: a closing remark is on
the card the moment you write it and dies with the card; a lesson outlives the card it came
from (its card reference is provenance, and its id is the whole of its identity once that
card is gone) and waits for the operator to decide whether a future session should learn
from it. **And Metis never seals her own record** — there is no approve/reject verb for her
to reach for, exactly as with the approval fence (ABSOLUTE RULE #5).
