import type { DispatcherPhase } from '@/shared/types.js';

/**
 * What the builders of a feature wrote under "Flags" in their reports, read back as one line each.
 *
 * A builder has no `followups` door, so the things it SAW and did not change (a file over the ceiling, a probe it could
 * not run, a ruling it needs) stay in its `result.md`, which nobody reads once the feature is done. The dispatcher's
 * document names each stage's report (`stage.output_path`), so this reader reaches them without the store: the builder's
 * reports are the stages the dispatcher itself calls the builder seats (`plan_runner/dactyls/switch.py` ROLES: `builder`
 * and `fix-pass`, which a second and third review round name `fix-pass-r2`, `fix-pass-r3`). A reviewer's or a docs
 * pass's report is not read: the review's findings are the review's own, and a docs pass records its rows elsewhere.
 *
 * The reports are free markdown written by a model, so the reading is deliberately plain and forgiving about shape. A
 * "flags" section opens on a HEADING with the word `flag` in it (`## Flags`, `## Flags for the caller`, `## Decisions and
 * flags`) or on a LABEL LINE (`**Flags**`, `**Flags:**`, `**Flags and follow-ups** (named, not done)`, a plain `Flags:`) —
 * recent builders write the label, and a quarter of the real flag lines sit under one. A heading's section runs to the next
 * heading of the same or a higher level; a label's runs to the next heading or the next bold label line; both end at the
 * report's `RESULT:` line. A FLAG is a top-level list item in the section — a nested bullet is that flag's own detail. A
 * section with no bullet at all is read by its paragraphs instead, so a builder who wrote its flag as a sentence is read too.
 * A flag is filed as its FIRST SENTENCE: the chat is told what to look at, and the rest stays in the report. A flag that is
 * only a bullet under an introduction (`Docs rows not updated:` then `- MAN-9059`) is filed with the introduction's words in
 * front, since the bullet means nothing alone.
 *
 * Consumed by `dispatcher-build-gaps.service.ts`, which files the lines on the feature's chat when the feature finishes.
 */

/** The stage names the dispatcher's builder seats carry — `builder`, `fix-pass`, and a later round's `fix-pass-r<N>`. */
const BUILDER_STAGE = /^(?:builder|fix-pass(?:-r\d+)?)$/;

/** A markdown heading: its `#` run and its title. */
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** A list item, bulleted or numbered: its indent and its text. */
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** The line every report ends on; nothing after it is a flag. */
const RESULT_LINE = /^RESULT:/;

/**
 * A line that is only a bold label, with an optional colon and an optional parenthetical after it — `**Flags**`, `**Flags:**`,
 * `**Flags and follow-ups** (named, not done)`. Text after the label on the same line (`**Flag:** I left no scratch`) makes it a
 * sentence, not a label.
 */
const BOLD_LABEL_LINE = /^\s*(?:\*\*|__)([^*_\n]+?)(?:\*\*|__):?\s*(?:\([^)\n]*\))?\s*$/;

/** A plain line that only names a section — `Flags for the caller:`, `Decisions and flags:`. */
const PLAIN_LABEL_LINE = /^[A-Za-z][^*_\n]{0,80}:\s*$/;

/** A section a label line opens ends at the next heading, which is deeper than any heading level the `#` run can name. */
const LABEL_SECTION_LEVEL = 7;

/**
 * Where a sentence ends: `.`, `!` or `?` (and any closing quote or bracket right after it) followed by a space or the end
 * of the text. A dot inside `companion-account.ts` or `497,000` is not followed by a space, and `e.g.` / `i.e.` / `vs.`
 * are not ends.
 */
const SENTENCE_END = /(?<!\b(?:e\.g|i\.e|vs))[.!?]["')\]`]*(?=\s|$)/i;

/**
 * A flag that is nothing: the `none` a builder writes when it has nothing to flag (`Follow-ups: none.`, `None spent.`), the
 * "no Gemini" and "no follow-ups" lines a brief asks every builder to state, and the `CLOSED: 8 of 8` tally of a fix-pass.
 * Anchored to the whole sentence: `none of the edits touch X` is a flag, `Gemini was not reachable` is a flag.
 */
const NOTHING =
  /^(?:[\w`' -]{0,40}:\s*)?(?:(?:none(?: spent)?|nothing|n\/a|nothing to (?:flag|report))\.?|no (?:gemini|follow-?ups?|flags?)\b[^.;,]*\.?)$|^`?(?:not )?closed: \d+ of \d+`?\.?$/i;

/** A flag that opens with a bold span: the span, a colon right after it if any, and what follows. A LABEL is one that ends in `.` or `:` (`**Row split.**`, `**Not touched:**`, `**Edits**:`); `**the probe** was not run` is emphasis. */
const BOLD_OPENING = /^\*\*(.+?)\*\*(:?)\s*(.*)$/;

/** One flag as the report wrote it: its text, and the words of the introduction it is a bullet under (`null` when it stands alone). */
type RawFlag = { lead: string | null; text: string };

/** A flag that only introduces a list (`Follow-ups, left as they are:`): it holds no content of its own, its nested bullets are the flags. */
function introducesList(text: string): boolean {
  return text.replace(/\*\*|__/g, '').trim().endsWith(':');
}

/**
 * The text with the markdown's emphasis marks taken off, and every run of whitespace, control and format characters made one
 * space — so the sentence is one plain line the followups lane will accept (`judgeLine` refuses a control character, and a
 * line it refuses would keep the feature due on every poll).
 */
function plainOf(text: string): string {
  return text.replace(/\*\*|__/g, '').replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ').trim();
}

/** The text up to and including its first sentence end, or all of it when it holds none. */
function leadSentenceOf(text: string): string {
  const end = SENTENCE_END.exec(text);
  return end === null ? text : text.slice(0, end.index + end[0].length);
}

/**
 * One flag as the line says it: its first sentence. A flag that opens with a bold LABEL (`**Row split.** MAN-9455 grew…`)
 * is a title and a sentence, so the label stays and the sentence after it is the one taken: `Row split: MAN-9455 grew…`.
 * Taken as a sentence of its own the label reads as nothing, and three lines in ten of the real reports open with one.
 * A flag whose bold text is all there is (`**The brief says X. The code says Y.**`) is its own text, cut at its first sentence.
 * Bold in the middle of a sentence (`**the probe** was not run`) is emphasis: the marks come off and the sentence stands.
 * A trailing `;`, `,` or `:` — the end of a bullet, not of a sentence — is taken off.
 */
function firstSentenceOf(flag: string): string {
  const opening = BOLD_OPENING.exec(flag.trim());
  const sentence =
    opening === null || !(opening[2] === ':' || /[.:]$/.test(opening[1]))
      ? leadSentenceOf(plainOf(flag))
      : plainOf(opening[3]) === ''
        ? leadSentenceOf(plainOf(opening[1]))
        : `${plainOf(opening[1]).replace(/[.:]$/, '')}: ${leadSentenceOf(plainOf(opening[3]))}`;

  return sentence.replace(/[;,:\s]+$/, '');
}

/** Whether the line is a label that opens a flags section (`isFlagLabel`) — a bold label line, or a plain `…:` line, that says `flag`. */
function isFlagLabel(line: string): boolean {
  const bold = BOLD_LABEL_LINE.exec(line);
  if (bold !== null) return /\bflags?\b/i.test(bold[1]);
  return !LIST_ITEM.test(line) && PLAIN_LABEL_LINE.test(line) && /\bflags?\b/i.test(line);
}

/**
 * The flags of one report, in the order written: the top-level list items of every flags section (a heading or a label line
 * that says `flag`), or — when the report's flags sections hold no bullet at all — their paragraphs. A list item continues over
 * the lines that follow it up to a blank line or a nested bullet (reports are hard-wrapped). An item that only introduces a list
 * (`introducesList`) is no flag: its nested bullets are, each taken as top-level and carrying the introduction's words as its
 * `lead`. Fenced code is skipped, so a `# comment` or a `- ` inside a code block is neither a heading nor a flag.
 */
function flagsOfReport(report: string): RawFlag[] {
  const flags: RawFlag[] = [];
  const paragraphs: RawFlag[] = [];
  let sectionLevel: number | null = null;
  let topIndent: number | null = null;
  let current: { text: string; open: boolean; lead: string | null } | null = null;
  let container: { lead: string; indent: number } | null = null;
  let paragraph: string | null = null;
  let inFence = false;

  const finishParagraph = (): void => {
    if (paragraph !== null) paragraphs.push({ lead: null, text: paragraph });
    paragraph = null;
  };
  const finishItem = (): void => {
    finishParagraph();
    if (current !== null && !introducesList(current.text)) flags.push({ lead: current.lead, text: current.text });
    current = null;
  };
  const openSection = (level: number): void => {
    sectionLevel = level;
    topIndent = null;
    container = null;
  };

  for (const line of report.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      finishParagraph();
      if (current !== null) current.open = false;
      continue;
    }
    if (inFence) continue;

    const heading = HEADING.exec(line);
    if (heading !== null) {
      finishItem();
      const level = heading[1].length;
      if (sectionLevel !== null && level <= sectionLevel) sectionLevel = null;
      if (sectionLevel === null && /flag/i.test(heading[2])) openSection(level);
      continue;
    }
    if (RESULT_LINE.test(line)) {
      finishItem();
      sectionLevel = null;
      continue;
    }

    const flagLabel = isFlagLabel(line);
    if (flagLabel || BOLD_LABEL_LINE.test(line)) {
      // A label line is no flag. A bold label ends a section a label opened (never one a heading opened), and a flags label opens one.
      if (sectionLevel === LABEL_SECTION_LEVEL || (flagLabel && sectionLevel === null)) finishItem();
      if (sectionLevel === LABEL_SECTION_LEVEL) sectionLevel = null;
      if (flagLabel && sectionLevel === null) openSection(LABEL_SECTION_LEVEL);
      continue;
    }
    if (sectionLevel === null) continue;

    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      finishParagraph();
      const indent = item[1].length;
      topIndent ??= indent;
      if (container !== null && indent <= container.indent) {
        topIndent = container.indent;
        container = null;
      }
      if (indent <= topIndent) {
        finishItem();
        current = { text: item[2], open: true, lead: container === null ? null : container.lead };
      } else if (current !== null && introducesList(current.text)) {
        // The list's own bullets are the flags: take them up a level, each one carrying the introduction's words.
        container = { lead: plainOf(current.text).replace(/:$/, '').trim(), indent: topIndent };
        topIndent = indent;
        current = { text: item[2], open: true, lead: container.lead };
      } else if (current !== null) {
        current.open = false;
      }
    } else if (line.trim() === '') {
      finishParagraph();
      if (current !== null) current.open = false;
    } else if (current !== null && current.open) {
      current.text += ` ${line.trim()}`;
    } else {
      paragraph = paragraph === null ? line.trim() : `${paragraph} ${line.trim()}`;
    }
  }
  finishItem();

  return flags.length > 0 ? flags : paragraphs;
}

/**
 * The first sentence of every flag the plan's builders wrote, in phase order and then stage order, each once and with the
 * `none`s left out (`NOTHING`). A flag that was a bullet under an introduction reads `<introduction>: <sentence>`. `readReport`
 * answers a report's text, or `null` when the file is gone (the dispatcher's souls directory is pruned) — a stage with no report
 * has no flags to give. Used by `dispatcher-build-gaps.service.ts`.
 */
export function buildFlagSentences(phases: DispatcherPhase[], readReport: (path: string) => string | null): string[] {
  const sentences: string[] = [];
  const seen = new Set<string>();

  for (const phase of phases) {
    for (const stage of phase.stages) {
      if (!BUILDER_STAGE.test(stage.name) || stage.output_path === null) continue;

      const report = readReport(stage.output_path);
      if (report === null) continue;

      for (const flag of flagsOfReport(report)) {
        const sentence = firstSentenceOf(flag.text);
        if (sentence === '' || NOTHING.test(sentence)) continue;

        const line = flag.lead === null ? sentence : `${flag.lead}: ${sentence}`;
        if (seen.has(line)) continue;
        seen.add(line);
        sentences.push(line);
      }
    }
  }

  return sentences;
}
