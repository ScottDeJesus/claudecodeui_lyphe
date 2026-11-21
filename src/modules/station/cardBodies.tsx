import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Markdown } from '@/modules/chat';
import { MARKDOWN_CARDS_CLASS } from '@/shared/constants';
import { buttonVariants } from '@/shared/ui';
import { cn } from '@/shared/utils';

/*
 * HER CARDS' BODIES, one per kind of card she puts up but the diff (the kit's `DiffLines`, the chat's own drawing). Each is
 * a pure function of the card's text, here and nowhere else, so a card reads the same wherever the stage draws it and no
 * other file parses her words a second way. Every text is drawn through the chat's own `Markdown` (the chat module's barrel), so a card renders whatever a chat renders —
 * headings, lists, tables, links, code and the sandboxed `widget` fence — laid out by the shape the reader that put it up gave it.
 *
 * Every body reads at body size and runs to the panel's width, which the station keeps to a reading measure (`MEASURE`). A list's row wraps
 * where a line may break (a space, a run id's dash, a path's slash); a token no break can split is never cut: the list scrolls
 * sideways inside the card for it, never the page.
 */

/**
 * The reading measure: a line of her text runs to the panel's width, which the station holds to 1,100 px of words at a desk (the shell's
 * `STAGE_TRACK_MAX`), as a chat's are. The box takes the body's size, so the text is the body's and not the panel's.
 */
const MEASURE = 'min-w-0 text-base';

/** Body size and the ink of what she wrote, for every body's text. */
const BODY_TEXT = 'text-base leading-relaxed text-foreground';

/**
 * A card's prose: the chat renderer's markup at the card's body size and ink (not the transcript's large serif), block
 * margins kept to a card's rhythm, the outer margins of the first and last block dropped so the card's own gaps hold; all three wear the chat reply's reading style (`MARKDOWN_CARDS_CLASS`), as a reply does.
 */
const CARD_PROSE =
  `prose prose-base max-w-none break-words text-foreground dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-4 prose-pre:my-3 prose-table:my-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0 ${MARKDOWN_CARDS_CLASS}`;

/** One list row's text through the same renderer, no paragraph margin, so the row's own padding and hairline set the rhythm. */
const ROW_PROSE =
  `prose prose-base max-w-none break-words text-foreground dark:prose-invert prose-p:my-0 prose-ul:my-1 prose-ol:my-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0 ${MARKDOWN_CARDS_CLASS}`;

/** The plan's lead, small and muted, through the same renderer. */
const LEAD_PROSE =
  `prose prose-sm max-w-none break-words text-muted-foreground dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-4 prose-pre:my-3 prose-table:my-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0 ${MARKDOWN_CARDS_CLASS}`;

/** The closing line of a list the eyes capped ("And 6 more; give a phrase to narrow."), which is its foot and not a row. */
const MORE_LINE = /^And \d+ more; /;

/** A plan's heading: a line at column 0 whose last character is a colon ("goal:", "delivers:", "architecture:"). */
const PLAN_HEADING = /^\S(?:.*\S)?:$/;

/** A line that opens block markdown — a code fence, a table row, or a markdown list item — which only reads right when the renderer sees the whole text, so a list card holding one is drawn whole rather than row by row. */
const BLOCK_MARKDOWN_LINE = /^ {0,3}(?:```|~~~|\||[-*+] |\d{1,9}[.)] )/m;

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

/** A NOTE: her words through the chat's own markdown renderer, her single line breaks kept. Used by this module's `NoteStageView`. */
export function NoteBody({ text }: { text: string }) {
  return (
    <div data-station-note-body="note" className={MEASURE}>
      <Markdown className={CARD_PROSE} breaks>
        {text}
      </Markdown>
    </div>
  );
}

/** A list's closing "And <n> more; …" line, in the muted ink, under its rows or under its whole text. */
function ListFoot({ text }: { text: string }) {
  return (
    <p data-list-foot="" className="text-sm text-muted-foreground">
      {text}
    </p>
  );
}

/**
 * A LIST: one row per line, a hairline between rows, a child row (two spaces in) indented on a rule under the row it
 * belongs to, and the eyes' "And <n> more; …" under the rows as the list's foot, in the muted ink. A row wraps where a line
 * may break, so a phone reads each row whole top to bottom; a token no break can split is never cut, and the rows scroll
 * sideways inside the card for it (`overscroll-x-contain`, so a swipe that reaches the end never becomes the browser's Back).
 * Each row's text is drawn through the chat's markdown renderer, so a row's bold, code and links render. A list whose text
 * holds block markdown (a fence, a table, a markdown list line) is drawn whole through one `Markdown` instead, as her panel
 * draws it, because those only read right when the renderer sees them whole.
 * Used by this module's `NoteStageView`.
 */
export function ListBody({ text }: { text: string }) {
  const { rows, foot } = listRows(text);
  if (BLOCK_MARKDOWN_LINE.test(text)) {
    const body = foot === null ? text : text.slice(0, text.lastIndexOf(foot));
    return (
      <div data-station-note-body="list" className="flex min-w-0 flex-col gap-3">
        <div data-list-whole="" className={MEASURE}>
          <Markdown className={CARD_PROSE} breaks>
            {body}
          </Markdown>
        </div>
        {foot !== null && <ListFoot text={foot} />}
      </div>
    );
  }
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
                'py-1.5',
                BODY_TEXT,
                row.child ? 'ml-1 border-l-2 border-border pl-4' : index > 0 && 'border-t border-border/60',
              )}
            >
              <Markdown className={ROW_PROSE}>{row.text}</Markdown>
            </li>
          ))}
        </ul>
      </div>
      {foot !== null && <ListFoot text={foot} />}
    </div>
  );
}

/**
 * A PLAN PAGE: a feature's design in its sections, each under its heading ("Goal", "Delivers", "Architecture",
 * "Decisions": the words as written, their first letter raised by the paint alone), its body through the chat's markdown renderer.
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
            {section.body !== '' && <Markdown className={LEAD_PROSE} breaks>{section.body}</Markdown>}
          </div>
        ) : (
          <section key={index} data-plan-section={section.heading} className="flex flex-col gap-1.5">
            <h3 className="text-base font-semibold text-foreground first-letter:uppercase">{section.heading}</h3>
            {section.body !== '' && <Markdown className={CARD_PROSE} breaks>{section.body}</Markdown>}
          </section>
        ),
      )}
    </div>
  );
}

/**
 * A DOCSPACE PAGE: the page's text as the eyes read it (its title, its blocks under their numbered heads), drawn through the chat's
 * markdown renderer, then "Open in DocSpace", the page in a new tab, a real link a reader can copy. Drawn
 * at the text's end, where the card's cut ("… narrow it to see the rest") sends him for the rest. `href` is null for a card
 * that names no page, which draws no link. Used by this module's `NoteStageView`.
 */
export function PageBody({ text, href }: { text: string; href: string | null }) {
  const { t } = useTranslation();
  return (
    <div data-station-note-body="page" className={cn('flex flex-col gap-3', MEASURE)}>
      <Markdown className={CARD_PROSE} breaks>
        {text}
      </Markdown>
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
