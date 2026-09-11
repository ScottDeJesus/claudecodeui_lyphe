import { Fragment, useContext } from 'react';
import type { ReactNode } from 'react';
import { FileTextIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePaletteOps } from '@/modules/command-palette';
import { ChipsSuppressedContext } from '@/modules/chat/transcript/shapes/chipContext';
import { FILE_REF_SCAN, parseFileRef } from '@/modules/chat/transcript/shapes/detect';

type FileChipProps = {
  path: string;
  /** The line the reference named, or null when it named none — never 0, which is not a line. */
  line: number | null;
  /** What the author wrote, verbatim: `src/a.ts:12`, suffix included. The chip never re-spells it. */
  children: ReactNode;
  /**
   * What to draw instead where a chip may not go (see `ChipsSuppressedContext`): the inline code
   * span, for a reference written in backticks. Defaults to `children`, the author's bare text.
   */
  plain?: ReactNode;
};

/**
 * A file reference the reader can click, opening the Files tab at the line it names.
 *
 * Used by `linkifyChildren` below for a reference sitting in prose, and by `code/InlineCode.tsx`
 * for one written as a whole inline code span. Both reach it only after `detect.ts` said yes, so
 * this component decides nothing: it draws what it was handed and forwards the line.
 *
 * A real `<button>`, not `Chip` and not an `<a>`. `Chip` with a click announces `aria-pressed`,
 * which tells a screen reader this is a toggle it can leave on; opening a file is an act, not a
 * state. An `<a>` would need an href, and the only one available is the bare path — which a
 * middle-click would open as a page of this app that does not exist. The look is the inline code
 * span's shape (border, rounded, mono), inked in `text-accent-ink` so it reads as the one span in
 * the sentence that does something. The fill is `bg-card`, not the code span's `bg-muted`: the
 * accent ink on the muted fill measures 4.49:1 in light, under AA, and 5.1:1 on the card.
 *
 * `data-line` is written only when there IS a line. An empty attribute would read back as `0`
 * through `Number()`, which is exactly the "opens at line 0" failure the chip must never have.
 *
 * Inside a link, a section heading or a table header it draws `plain` instead: those are controls
 * or labels already, and a button inside one is a click that fires twice.
 */
export function FileChip({ path, line, children, plain }: FileChipProps) {
  const { t } = useTranslation('chat');
  const { openFileReference } = usePaletteOps();
  const suppressed = useContext(ChipsSuppressedContext);
  if (suppressed) return <>{plain ?? children}</>;
  const label = t('shapes.openFile', { path: line === null ? path : `${path}:${line}` });

  return (
    <button
      type="button"
      data-shape="chip"
      data-collapsed="false"
      data-file-chip=""
      data-path={path}
      data-line={line ?? undefined}
      title={label}
      aria-label={label}
      onClick={() => openFileReference(path, line ?? undefined)}
      className="inline max-w-full cursor-pointer rounded-md border border-border/70 bg-card px-1.5 py-0.5 text-left align-baseline font-mono text-[0.875em] text-accent-ink [overflow-wrap:anywhere] hover:border-accent-ink/50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FileTextIcon aria-hidden="true" className="mr-1 inline-block h-[1em] w-[1em] align-[-0.125em]" />
      {children}
    </button>
  );
}

type ColorSwatchProps = {
  /** The colour, exactly as `parseHexColor` returned it. It is the author's, painted as data. */
  color: string;
  /** The inline code span showing the colour's text, drawn by `InlineCode` as it always was. */
  children: ReactNode;
};

/**
 * A hex colour in inline code, with a chip of that colour painted in front of its text.
 *
 * Used by `code/InlineCode.tsx` and nothing else. The code span is passed in whole rather than
 * rebuilt here, so the text keeps today's face to the byte and the swatch is the only addition.
 *
 * The fill is the one colour under `shapes/` that is not a token, and it cannot be: it is the
 * value the author wrote, arriving as data through `style`, never as a literal in this source. The
 * border IS a token, so a white swatch on the light page and a black one on the dark page still
 * show an edge instead of a hole in the sentence.
 */
export function ColorSwatch({ color, children }: ColorSwatchProps) {
  return (
    <span data-shape="swatch" data-collapsed="false" className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span
        data-swatch-color={color}
        aria-hidden="true"
        className="inline-block h-[0.85em] w-[0.85em] shrink-0 self-center rounded-sm border border-border"
        style={{ backgroundColor: color }}
      />
      {children}
    </span>
  );
}

type KeyCapsProps = {
  /** The keys in the order they are pressed, canonically spelled by `parseKeyCombo`. */
  keys: string[];
};

/**
 * A keyboard shortcut drawn as keycaps: one `<kbd>` per key inside one `<kbd>` for the whole.
 *
 * Used by `code/InlineCode.tsx` and nothing else. The nesting is HTML's own way of writing a key
 * COMBINATION, so assistive technology reads one input made of several keys. The `+` between them
 * is real text rather than decoration — "Ctrl + C" is what a person should hear, and a copy of
 * the sentence should paste as the shortcut, not as `CtrlC`.
 */
export function KeyCaps({ keys }: KeyCapsProps) {
  return (
    <kbd data-shape="keys" data-collapsed="false" className="inline-flex flex-wrap items-baseline gap-0.5 font-sans">
      {keys.map((key, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="text-[0.8em] text-muted-foreground">+</span>}
          <kbd className="rounded border border-b-2 border-border bg-muted px-1.5 py-px font-mono text-[0.8em] leading-snug text-foreground">
            {key}
          </kbd>
        </Fragment>
      ))}
    </kbd>
  );
}

/**
 * One plain string with every file reference in it replaced by a `FileChip`, or the SAME string
 * back when it holds none — returning the input unchanged is what keeps a paragraph without a
 * path byte-identical, and saves the reconciler an array it would otherwise have to diff.
 *
 * `FILE_REF_SCAN` carries the `g` flag, and `matchAll` is on its list of safe methods: it clones
 * the regex, so no `lastIndex` survives from one string to the next. Every hit is re-read through
 * `parseFileRef`, the same grammar's whole-text form, for its path and line; a hit it declines
 * stays text, so the two readers can never disagree on screen.
 */
function linkifyString(text: string, keyPrefix: string): ReactNode {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(FILE_REF_SCAN)) {
    const ref = parseFileRef(match[0]);
    if (!ref || match.index === undefined) continue;
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    parts.push(
      <FileChip key={`${keyPrefix}-${match.index}`} path={ref.path} line={ref.line}>
        {match[0]}
      </FileChip>
    );
    cursor = match.index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/**
 * Turns every `path/to/file.ext:line` sitting in a block's PLAIN TEXT into a file chip.
 *
 * Its only caller is `elements/inlineText.tsx`'s `renderInline`, the one seam through which a
 * paragraph, a list item, a table cell and the two list shapes that redraw their rows post-process
 * their rendered inline content. Never a heading, never a table header cell, never a fence: none of
 * those reaches that seam.
 *
 * ONLY strings are split. Every element child — a bold, a link, an inline code span, a math span —
 * is handed back as the very same element, same key, same props, never cloned and never walked
 * into. That is what keeps `**bold**` bold and a key on every child, and it is also why a path
 * inside a markdown link stays the link the `a` override drew instead of becoming a chip inside a
 * link. A path inside `**bold**` therefore stays text: a missed chip costs nothing, a rebuilt
 * element can cost the author's formatting.
 *
 * With no hit anywhere it returns `children` itself, not a copy.
 *
 * It lives beside the components because the plan's interface names this file as its home, and it
 * is the one non-component export here: the lint rule below guards Fast Refresh, and the only cost
 * of waiving it is a full reload, in development, when this file is edited.
 */
// oxlint-disable-next-line react/only-export-components
export function linkifyChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') return linkifyString(children, 'chip');
  if (!Array.isArray(children)) return children;

  let changed = false;
  const next = children.map((child, index) => {
    if (typeof child !== 'string') return child;
    const linked = linkifyString(child, `chip-${index}`);
    if (linked === child) return child;
    changed = true;
    // One keyed Fragment where the string was, so the array keeps one entry per original child
    // and every sibling element keeps the position — and the key — react-markdown gave it.
    return <Fragment key={`linkified-${index}`}>{linked}</Fragment>;
  });
  return changed ? next : children;
}
