import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { buttonVariants } from '@/shared/ui';
import { cn } from '@/shared/utils';

/*
 * HER CARDS' BODIES, one per kind of card she puts up but the diff (the kit's `DiffLines`, the chat's own drawing). Each is
 * a pure function of the card's text, here and nowhere else, so a card reads the same wherever the stage draws it and no
 * other file parses her words a second way. Her text is drawn as she put it: nothing is reflowed, re-ordered or dropped,
 * only laid out by the shape the reader that put it up gave it.
 *
 * Every body reads at body size, its lines kept to a reading measure (`MEASURE`) however wide the stage. A list's row wraps
 * where a line may break (a space, a run id's dash, a path's slash); a token no break can split is never cut: the list scrolls
 * sideways inside the card for it, never the page.
 */

/**
 * The reading measure: a line of her text runs at most 72 characters, however wide the stage stands. The box takes the body's
 * size too, so its `ch` is a character of the text it holds and not of the stage around it.
 */
const MEASURE = 'max-w-[72ch] text-base';

/** Body size and the ink of what she wrote, for every body's text. */
const BODY_TEXT = 'text-base leading-relaxed text-foreground';

/** The closing line of a list the eyes capped ("And 6 more; give a phrase to narrow."), which is its foot and not a row. */
const MORE_LINE = /^And \d+ more; /;

/** A plan's heading: a line at column 0 whose last character is a colon ("goal:", "delivers:", "architecture:"). */
const PLAN_HEADING = /^\S(?:.*\S)?:$/;

/** `text`'s paragraphs: the runs of lines between blank lines, each kept as written, line breaks and all; none empty. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, ''))
    .filter((paragraph) => paragraph.trim() !== '');
}

/**
 * A list's rows: each line one row, a line opening with two spaces a child of the row above it (its text without them, the
 * indent drawn instead), and a last line that is the eyes' "And <n> more; …" its foot. Blank lines are no rows.
 */
function listRows(text: string): { rows: { text: string; child: boolean }[]; foot: string | null } {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const last = lines.at(-1);
  const foot = last !== undefined && MORE_LINE.test(last) ? last : null;
  const body = foot === null ? lines : lines.slice(0, -1);
  return { rows: body.map((line) => (line.startsWith('  ') ? { text: line.trimStart(), child: true } : { text: line, child: false })), foot };
}

/**
 * A plan's sections: a line at column 0 ending in a colon heads one (its words without the colon), and what follows it up to
 * the next is its body, kept as written (indent and all), only the blank lines at its edges dropped. What stands before the
 * first heading (the card's name and its facts) is a section with no heading.
 */
function planSections(text: string): { heading: string | null; body: string }[] {
  const sections: { heading: string | null; body: string }[] = [];
  let heading: string | null = null;
  let lines: string[] = [];
  const close = () => {
    const body = lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
    if (heading !== null || body.trim() !== '') sections.push({ heading, body: body.trim() === '' ? '' : body });
  };
  for (const line of text.split('\n')) {
    if (PLAN_HEADING.test(line.trimEnd())) {
      close();
      heading = line.trimEnd().slice(0, -1);
      lines = [];
    } else {
      lines.push(line);
    }
  }
  close();
  return sections;
}

/** A NOTE: her words, a paragraph between each blank line, her own line breaks kept. Used by this module's `NoteStageView`. */
export function NoteBody({ text }: { text: string }) {
  return (
    <div data-station-note-body="note" className={cn('flex flex-col gap-3', MEASURE)}>
      {paragraphsOf(text).map((paragraph, index) => (
        <p key={index} className={cn('whitespace-pre-line break-words', BODY_TEXT)}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}

/**
 * A LIST: one row per line, a hairline between rows, a child row (two spaces in) indented on a rule under the row it
 * belongs to, and the eyes' "And <n> more; …" under the rows as the list's foot, in the muted ink. A row wraps where a line
 * may break, so a phone reads each row whole top to bottom; a token no break can split is never cut, and the rows scroll
 * sideways inside the card for it (`overscroll-x-contain`, so a swipe that reaches the end never becomes the browser's Back).
 * Used by this module's `NoteStageView`.
 */
export function ListBody({ text }: { text: string }) {
  const { rows, foot } = listRows(text);
  return (
    <div data-station-note-body="list" className="flex min-w-0 flex-col gap-3">
      {/* The card's inset is cancelled and put back inside the scroller, so a row that runs long scrolls to the card's edge. */}
      <div data-station-note-scroll="" className="-mx-4 overflow-x-auto overscroll-x-contain px-4 lg:-mx-5 lg:px-5">
        <ul className={cn('flex flex-col', MEASURE)}>
          {rows.map((row, index) => (
            <li
              key={index}
              data-list-row={row.child ? 'child' : 'item'}
              className={cn(
                'whitespace-pre-wrap py-1.5',
                BODY_TEXT,
                row.child ? 'ml-1 border-l-2 border-border pl-4' : index > 0 && 'border-t border-border/60',
              )}
            >
              {row.text}
            </li>
          ))}
        </ul>
      </div>
      {foot !== null && (
        <p data-list-foot="" className="text-sm text-muted-foreground">
          {foot}
        </p>
      )}
    </div>
  );
}

/**
 * A PLAN PAGE: a feature's design in its sections, each under its heading ("Goal", "Delivers", "Architecture",
 * "Decisions": the words as written, their first letter raised by the paint alone), its body as written, indent and all.
 *
 * THE LEAD stands first, small, in the muted ink: what comes before the plan's own sections. Her reader writes an intro
 * ("The design of <card>:", a column-0 line ending in a colon, which `planSections` reads as a heading like any other) over
 * the card's name and facts, so when other sections follow it the first section is the lead, its heading and its body both
 * quiet; a text with no intro leads with what stands before its first heading. A text of one section (a phrase read: the
 * intro over the paragraphs around the phrase) has no lead: its one section is the content. Used by this module's
 * `NoteStageView`.
 */
export function PlanBody({ text }: { text: string }) {
  const sections = planSections(text);
  return (
    <div data-station-note-body="plan" className={cn('flex flex-col gap-5', MEASURE)}>
      {sections.map((section, index) =>
        section.heading === null || (index === 0 && sections.length > 1) ? (
          <div key={index} data-plan-facts="" className="flex flex-col text-sm leading-relaxed text-muted-foreground">
            {section.heading !== null && <p className="font-medium">{section.heading}</p>}
            {section.body !== '' && <p className="whitespace-pre-wrap break-words">{section.body}</p>}
          </div>
        ) : (
          <section key={index} data-plan-section={section.heading} className="flex flex-col gap-1.5">
            <h3 className="text-base font-semibold text-foreground first-letter:uppercase">{section.heading}</h3>
            {section.body !== '' && <p className={cn('whitespace-pre-wrap break-words', BODY_TEXT)}>{section.body}</p>}
          </section>
        ),
      )}
    </div>
  );
}

/**
 * A DOCSPACE PAGE: the page's text as the eyes read it (its title, its blocks under their numbered heads), a paragraph between
 * each blank line with its indent kept, then "Open in DocSpace", the page in a new tab, a real link a reader can copy. Drawn
 * at the text's end, where the card's cut ("… narrow it to see the rest") sends him for the rest. `href` is null for a card
 * that names no page, which draws no link. Used by this module's `NoteStageView`.
 */
export function PageBody({ text, href }: { text: string; href: string | null }) {
  const { t } = useTranslation();
  return (
    <div data-station-note-body="page" className={cn('flex flex-col gap-3', MEASURE)}>
      {paragraphsOf(text).map((paragraph, index) => (
        <p key={index} className={cn('whitespace-pre-wrap break-words', BODY_TEXT)}>
          {paragraph}
        </p>
      ))}
      {href !== null && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          data-station-note-page-open=""
          className={cn(buttonVariants({ variant: 'outline' }), 'mt-1 self-start finger:h-11')}
        >
          {t('station.cards.openInDocSpace', { defaultValue: 'Open in DocSpace' })}
          <ArrowUpRight aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
