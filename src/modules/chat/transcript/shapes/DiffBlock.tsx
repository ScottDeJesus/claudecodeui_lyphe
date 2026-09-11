import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, CopyIcon } from 'lucide-react';

import type { Tone } from '@/shared/types';
import { copyTextToClipboard, cn } from '@/shared/utils';
import { splitDiffLine } from '@/modules/chat/transcript/shapes/detect';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';
import { useShapeInteractive } from '@/modules/chat/transcript/shapes/useShapeCollapse';

type DiffLineKind = ReturnType<typeof splitDiffLine>;

type DiffBlockProps = {
  /** The fence body verbatim — what is drawn line by line and what the copy action copies. */
  raw: string;
  collapseKey: string;
};

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
 * A `diff` fence coloured by line kind: added, removed, hunk, meta and context.
 *
 * Used by `code/CodeFence.tsx` and nothing else. It reads the fence TEXT through `splitDiffLine`
 * and nothing more, so it takes no dependency on `ToolDiffViewer`'s `createDiff` contract — that
 * viewer diffs two strings it was handed, and a fence is a diff someone already wrote.
 *
 * Every line the author wrote is drawn, verbatim and in order, and the `+` / `-` / `@@` that open
 * each one stay in the text: they are the non-colour channel, and removing them to lean on the
 * tint alone would render less than the markdown this replaced.
 *
 * The header carries the count of added and removed lines, so the size of the change is readable
 * before the body is, and the copy action — which always copies the whole fence — is not drawn at
 * all in an export, for the reason `ShapeFrame` drops its toggle there.
 */
export function DiffBlock({ raw, collapseKey }: DiffBlockProps) {
  const { t } = useTranslation('chat');
  // False inside a transcript export, where no click handler can ever run.
  const interactive = useShapeInteractive();
  // Whether the last copy landed, so the action can say so for a moment. The effect resets it.
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const lines = useMemo(() => raw.split('\n').map((text) => ({ text, kind: splitDiffLine(text) })), [raw]);
  const added = lines.filter((line) => line.kind === 'add').length;
  const removed = lines.filter((line) => line.kind === 'remove').length;

  const actions = (
    <>
      <span data-diff-summary className="inline-flex items-center gap-1.5 font-mono tabular-nums">
        <span data-tone="positive" className="text-[color:var(--tone-ink)]">
          +{added}
        </span>
        {/* Draws nothing between flex items, but a screen reader and a copy-paste get "+3 −2". */}{' '}
        <span data-tone="danger" className="text-[color:var(--tone-ink)]">
          −{removed}
        </span>
      </span>
      {interactive ? (
        <button
          type="button"
          data-copy-code
          onClick={() => void copyTextToClipboard(raw).then((didCopy) => didCopy && setCopied(true))}
          title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
          aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
          className="inline-flex items-center rounded p-1 transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <CheckIcon aria-hidden="true" className="h-3.5 w-3.5 text-accent-ink" />
          ) : (
            <CopyIcon aria-hidden="true" className="h-3.5 w-3.5" />
          )}
        </button>
      ) : null}
    </>
  );

  return (
    <ShapeFrame kind="diff" title={t('shapes.titles.diff')} collapseKey={collapseKey} actions={actions}>
      {/* The frame's inset is cancelled so each line's tint runs edge to edge, and the body scrolls
          sideways rather than wrapping — a wrapped diff line reads as two lines, one of them
          unmarked. `w-max min-w-full` keeps every tint as wide as the widest line. */}
      <div className="-mx-3 -my-2 overflow-x-auto">
        <div className="w-max min-w-full py-2 font-mono text-[0.8125rem] leading-relaxed">
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
      </div>
    </ShapeFrame>
  );
}
