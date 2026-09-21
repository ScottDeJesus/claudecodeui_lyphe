/**
 * The memory-intake lane's size guard: how large a target file may grow, and what we say when it
 * may not.
 *
 * WHY THIS IS ITS OWN FILE. `memory-assert.ts` answers "where does this memory go, and how do I put
 * it there". This answers a different question — "how big may that file get, and what do I tell the
 * person when the answer is no" — asked by a different reader, changing on a different schedule.
 * The split is also what makes the table below checkable by reading one file.
 *
 * THE SEMANTICS ARE PORTED; THE PROSE IS OURS. The numbers and the no-regression ratchet come from
 * `~/.claude/hooks/enforce_memory_limits.py:237-338`, the predicate that guards a session's own
 * MEMORY.md edits, with the same lockstep `~/.claude/settings.json` passes it (`MEMORY_MAX_LINES=200`
 * and a `MEMORY_MAX_LINE_CHARS` default of 250). This server calls nothing there — the hook is
 * Python, and a subprocess in the write path would be a second
 * failure mode between a person's click and their file. So the measurement is ported, and the two
 * implementations move together: change a number in one and change the other in the same diff.
 *
 * What is NOT ported is that hook's wording. It speaks about one file (a project's MEMORY.md) in one
 * voice ("Relax via MEMORY_MAX_LINE_CHARS", "move prose to a topic file"), and every one of those
 * sentences is false or inert here: this lane is often writing a topic NOTE, it reads no env var,
 * and no sentence of ours may be relaxed by setting one. Each reason below names the real file, the
 * real number, and a remedy that exists — because these words become the candidate's recorded
 * refusal, the text a person reads to decide what to trim.
 *
 * WHAT IS CAPPED, AND WHAT DELIBERATELY IS NOT. A memory is PROSE, and markdown prose is one long
 * line per paragraph — a per-line budget on a prose target would refuse this lane's own happy path.
 * So a per-line budget belongs to exactly one file, a project's MEMORY.md, which genuinely IS an
 * index of one-line pointers. A topic note carries no budget at all (it is the shed the index points
 * AT, and length there is the point) and neither does CLAUDE.md, whose fences are elsewhere and are
 * deliberate: the 4,000-character body bound every candidate passes at staging, and the panel's own
 * warning on a target that reaches every session of every project.
 *
 * A `null` entry means nothing is measured and no reason can be produced. Fail-CLOSED applies only
 * where a budget exists, and here that is absolute: this predicate is compiled into the module, so
 * there is no load that could fail and no path on which a budgeted file is written unmeasured.
 */

/** One file's size budget. A dimension the file does not carry is simply absent, and is not checked. */
export type Caps = {
  maxLines?: number;
  maxLineChars?: number;
  maxTotalChars?: number;
};

/** The five budgeted (or deliberately unbudgeted) files this lane writes, by the step that writes them. */
export type CapsKey = 'memoryMd' | 'topicNote' | 'rulesMd' | 'requirementsMd' | 'claudeMd';

/**
 * THE cap table. One entry per file a step can write, and one place the numbers live.
 *
 * `memoryMd` is a project's index: ~200 one-line router pointers, both dimensions. `rulesMd` and
 * `requirementsMd` are main-only shelves whose cost is their TOTAL size — `hooks/load_main_shelves.py`
 * injects each whole file verbatim on every SessionStart, and 60 lines / 2,000 characters is the
 * budget each shelf's own header states — so they carry no per-line dimension: a rule or a
 * requirement is a sentence, and a sentence is one line. Two shelves, one budget each, split by
 * subject rather than by size (RULES = how to behave, REQUIREMENTS = what to build or keep true).
 */
export const MEMORY_CAPS: Record<CapsKey, Caps | null> = {
  memoryMd: { maxLines: 200, maxLineChars: 250 },
  topicNote: null,
  rulesMd: { maxLines: 60, maxTotalChars: 2000 },
  requirementsMd: { maxLines: 60, maxTotalChars: 2000 },
  claudeMd: null,
};

/** How many lines `text` holds, as `str.split` counts them — a trailing newline opens an empty last one. */
function countLines(text: string): number {
  return text.split('\n').length;
}

/** The longest line in `text`, in characters. Plain measurement, for the message only. */
function longestLine(text: string): number {
  return text.split('\n').reduce((longest, line) => Math.max(longest, line.length), 0);
}

/**
 * How many lines of `text` exceed `cap`, and by how much in total.
 *
 * `overflow` is Σ (length − cap) over every over-long line: a MONOTONIC measure of total over-length
 * bloat, and therefore the ratchet metric. An edit that adds an over-long line, or lengthens ANY
 * over-long line, raises it; holding or shrinking does not. A longest-line-only metric would miss a
 * secondary line being inflated up to the current maximum, which this closes.
 *
 * Headers and blank lines are exempt — a `##` heading is a title, not a pointer, and enforcing the
 * cap on one would refuse a file for its section names.
 */
function overLongLines(text: string, cap: number): { count: number; overflow: number } {
  let count = 0;
  let overflow = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    if (line.length > cap) {
      count += 1;
      overflow += line.length - cap;
    }
  }
  return { count, overflow };
}

/**
 * Plain-English reasons for every budget `next` would breach. An empty list means the write is
 * compliant and may go ahead.
 *
 * `display` is what a person calls this file ("your RULES.md shelf", "the -opt-my-project
 * memory index MEMORY.md") — every reason names it, so a refusal can never be about a file nobody
 * was writing to.
 *
 * `current` is the file as it stands (the empty string for one that does not exist yet), and every
 * dimension keeps the borrowed ratchet: a breach counts only when the edit makes that dimension
 * WORSE than the file already is. That is what lets an over-budget file be edited back DOWN — an
 * absolute check would deadlock the very edits that would fix it.
 *
 * `caps === null` returns immediately: no budget means nothing is measured, and the caller's
 * `planned` step is written unchecked because there is nothing to check.
 */
export function capRefusals(caps: Caps | null, display: string, next: string, current: string): string[] {
  if (caps === null) return [];

  const reasons: string[] = [];

  if (caps.maxLines !== undefined) {
    const grown = countLines(next);
    if (grown > caps.maxLines && grown > countLines(current)) {
      reasons.push(
        `${display} would grow to ${grown} lines, past its ${caps.maxLines}-line budget. It is an `
          + `index of one-line pointers — move detail into a note and leave a pointer to it.`
      );
    }
  }

  if (caps.maxLineChars !== undefined) {
    const grown = overLongLines(next, caps.maxLineChars);
    if (grown.count > 0 && grown.overflow > overLongLines(current, caps.maxLineChars).overflow) {
      reasons.push(
        `${display} would gain a line longer than ${caps.maxLineChars} characters (its longest `
          + `would be ${longestLine(next)}). It holds one-line pointers — put the detail in the note `
          + `the pointer names.`
      );
    }
  }

  if (caps.maxTotalChars !== undefined && next.length > caps.maxTotalChars && next.length > current.length) {
    reasons.push(
      `${display} would grow to ${next.length} characters, past its ${caps.maxTotalChars}-character `
        + `budget. The whole file is read into every session, so its total size is the cost — trim `
        + `an entry before adding another.`
    );
  }

  return reasons;
}
