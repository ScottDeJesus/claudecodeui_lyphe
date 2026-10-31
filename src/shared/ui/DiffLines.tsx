import { useMemo } from 'react';

import type { Tone } from '@/shared/types';
import { cn, splitDiffLine } from '@/shared/utils';

type DiffLineKind = ReturnType<typeof splitDiffLine>;

/**
 * The tone each kind of line wears, as `data-tone`. Colour is the token swap tokens.css makes for
 * that attribute and never a class of this file's: added lines are `positive`, removed lines
 * `danger`, a hunk header `info`. Meta and context lines carry no tone at all — they are the
 * frame of the change, not the change.
 */
const TONE_BY_KIND: Record<DiffLineKind, Tone | undefined> = {
  add: 'positive',
  remove: 'danger',
  hunk: 'info',
  meta: undefined,
  context: undefined,
};

/** The paint of each kind, read off the `--tone-*` properties its `data-tone` sets. */
const CLASS_BY_KIND: Record<DiffLineKind, string> = {
  add: 'bg-[color:var(--tone-soft)] text-[color:var(--tone-ink)]',
  remove: 'bg-[color:var(--tone-soft)] text-[color:var(--tone-ink)]',
  hunk: 'bg-muted/60 text-[color:var(--tone-ink)]',
  meta: 'font-semibold text-muted-foreground',
  context: 'text-foreground',
};

/**
 * The block's own classes. Added to, never merged over: `cn` reads `text-md-code` as a text COLOUR (the
 * merge does not know the project's size key), so a caller's `text-*` class would silently drop it.
 */
const BLOCK_CLASSES = 'w-max min-w-full font-mono text-md-code leading-relaxed';

/**
 * A unified diff's lines, each painted by its kind through `data-tone`, its +, − and @@ kept in the
 * text. Consumed by the chat module's DiffBlock and the station module's diff card.
 *
 * Every line of `text` is drawn, verbatim and in order, and the `+` / `-` / `@@` that open each one
 * stay in the text: they are the non-colour channel, and leaning on the tint alone would draw less
 * than the diff someone wrote. Lines never wrap — a wrapped diff line reads as two lines, one of
 * them unmarked — so the block is `w-max min-w-full`, as wide as its widest line with every tint
 * running that far, and the CALLER's container owns the sideways scroll (`overflow-x-auto`) and the
 * inset the tint should cancel.
 *
 * `className` is added to the block's own classes (width, mono face, line height); it does not
 * merge over them, so a caller sets spacing, not the face.
 */
export function DiffLines({ text, className }: { text: string; className?: string }) {
  const lines = useMemo(() => text.split('\n').map((line) => ({ text: line, kind: splitDiffLine(line) })), [text]);

  return (
    <div className={className ? `${BLOCK_CLASSES} ${className}` : BLOCK_CLASSES}>
      {lines.map((line, index) => (
        <div
          key={index}
          data-diff-line={line.kind}
          data-tone={TONE_BY_KIND[line.kind]}
          // `min-h` so a blank context line keeps its row instead of collapsing to nothing.
          className={cn('min-h-[1.625em] whitespace-pre px-3', CLASS_BY_KIND[line.kind])}
        >
          {line.text}
        </div>
      ))}
    </div>
  );
}
