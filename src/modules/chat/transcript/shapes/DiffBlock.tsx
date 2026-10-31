import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckIcon, CopyIcon } from 'lucide-react';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { DiffLines } from '@/shared/ui';
import { copyTextToClipboard, splitDiffLine } from '@/shared/utils';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';
import { useShapeInteractive } from '@/modules/chat/transcript/shapes/useShapeCollapse';

type DiffBlockProps = {
  /** The fence body verbatim — what is drawn line by line and what the copy action copies. */
  raw: string;
  collapseKey: string;
};

/**
 * A `diff` fence coloured by line kind: added, removed, hunk, meta and context.
 *
 * Used by `code/CodeFence.tsx` and nothing else. It reads the fence TEXT and nothing more, so it
 * takes no dependency on `ToolDiffViewer`'s `createDiff` contract — that viewer diffs two strings
 * it was handed, and a fence is a diff someone already wrote.
 *
 * The lines are the kit's `DiffLines`, the one drawing of a diff the station's diff card shares:
 * every line the author wrote, verbatim and in order, its `+` / `-` / `@@` kept as the non-colour
 * channel. What stays here is the frame — the count in the header, the copy action, and the
 * sideways scroll that keeps a wide line from wrapping.
 *
 * The header carries the count of added and removed lines, so the size of the change is readable
 * before the body is, and the copy action — which always copies the whole fence — is not drawn at
 * all in an export, for the reason `ShapeFrame` drops its toggle there.
 */
export function DiffBlock({ raw, collapseKey }: DiffBlockProps) {
  const { t } = useTranslation('chat');
  // The window the block is drawn in: the copy goes through its clipboard and the "copied" tick is
  // timed on it.
  const hostWindow = useHostWindow();
  // False inside a transcript export, where no click handler can ever run.
  const interactive = useShapeInteractive();
  // Whether the last copy landed, so the action can say so for a moment. The effect resets it.
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = hostWindow.setTimeout(() => setCopied(false), 1600);
    return () => hostWindow.clearTimeout(timer);
  }, [copied, hostWindow]);

  const kinds = useMemo(() => raw.split('\n').map(splitDiffLine), [raw]);
  const added = kinds.filter((kind) => kind === 'add').length;
  const removed = kinds.filter((kind) => kind === 'remove').length;

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
          onClick={() => void copyTextToClipboard(raw, hostWindow).then((didCopy) => didCopy && setCopied(true))}
          title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
          aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
          className="inline-flex items-center rounded p-1 transition-colors hover:bg-muted hover:text-foreground"
        >
          {/* Sized in `em`, like the frame's own chevron and icon: the actions slot reads
              `text-md-meta`, so `1em` is today's 14px at the default chat size and follows the
              reader's chat text size rather than staying 14px. */}
          {copied ? (
            <CheckIcon aria-hidden="true" className="h-[1em] w-[1em] text-accent-ink" />
          ) : (
            <CopyIcon aria-hidden="true" className="h-[1em] w-[1em]" />
          )}
        </button>
      ) : null}
    </>
  );

  return (
    <ShapeFrame kind="diff" title={t('shapes.titles.diff')} collapseKey={collapseKey} actions={actions}>
      {/* The frame's inset is cancelled so each line's tint runs edge to edge, and the body scrolls
          sideways rather than wrapping; `py-2` puts the vertical inset back inside the scroller. */}
      <div className="-mx-3 -my-2 overflow-x-auto">
        <DiffLines text={raw} className="py-2" />
      </div>
    </ShapeFrame>
  );
}
