import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, Shrink } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import type { ChatCompactionMarker } from '@/shared/types';
import { formatTokenCount } from '@/modules/chat/utils/chatFormatting';

type CompactionMarkerProps = {
  /** The compaction this row stands for, as its `compaction` row carries it. */
  marker: ChatCompactionMarker;
  /**
   * Turns a model id into the name the catalog shows for it, or null when the catalog has never heard
   * of it: the pane's own function, the one every reply's caption is named by. A null falls back to the
   * summarizer's word, never to the chat's provider, because that word is the operator's own choice.
   */
  resolveModelLabel?: (modelId: string) => string | null;
};

/** The words for each trigger, spelled out so every key can be found by its name. */
const TRIGGER_KEYS = {
  manual: 'compaction.trigger.manual',
  auto: 'compaction.trigger.auto',
  idle: 'compaction.trigger.idle',
} as const;

/**
 * The arrow between a context before and after. The font's own `→` stands small on the baseline at 12px,
 * where "412K → 14K" can read as a range, so the icon draws it; the locale's glyph is kept for a screen
 * reader.
 */
function ToArrow({ children }: { children?: ReactNode }) {
  return (
    <>
      <ArrowRight aria-hidden="true" className="inline h-3 w-3 align-[-0.125em]" />
      <span className="sr-only">{children}</span>
    </>
  );
}

/**
 * One line of facts. Each fact is kept whole (an inline block) and carries the dot that follows it, so a
 * narrow screen breaks the line between two facts, never inside one, and never starts a line with a dot.
 */
function FactLine({ facts, className }: { facts: ReactNode[]; className: string }) {
  return (
    <p className={className}>
      {facts.map((fact, index) => (
        // A line's facts never reorder, so a fact's place is its identity.
        <Fragment key={index}>
          {index > 0 && ' '}
          <span className="inline-block">
            {fact}
            {index < facts.length - 1 && '\u00a0·'}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * THE LINE A COMPACTION LEAVES IN THE TRANSCRIPT, between the conversation it summarized and the summary
 * the chat now carries in its place. Everything above it reached the model only through that summary.
 *
 * It is a divider row, Verve's own shape for a boundary in a thread: a hairline either side of a quiet
 * label. It wears `Shrink`, the glyph on the usage panel's Compact button, so the press and what it left
 * behind share one mark. Two lines of facts follow the label:
 * - first what the operator asks first: why it ran (his own `/compact`, pressed or typed, a turn's end
 *   past half the window, or the idle deadline) and what it did to the context, "412K → 14K tokens";
 * - then who wrote the summary, the served model by its catalog name at its effort, and what that model
 *   read and wrote, with the number of parts when one call could not hold the transcript.
 *
 * Tokens only, never dollars: the operator's Claude use is a subscription. The context after is the CLI's
 * own count of the new session at the compaction's end, known once the seed append has been counted, so
 * the live row holds its place with "…" until the history row brings it. The
 * label carries no clock: the reply above it is captioned with its time and the summary under it ends
 * with its own, so the moment of the swap is only on hover.
 *
 * Neutral on purpose. A compaction is routine and asks nothing of the operator, so no tone colours it,
 * and it is always shown: it is not work, which "Show work" hides, and it is not the summary, which the
 * summary preference hides.
 *
 * Rendered by chat's MessageComponent for a row carrying `isCompactionMarker`, which `normalizedToChatMessages`
 * makes of a `compaction` message. That row is assistant-side with no content of its own: content would make
 * the pane take it for the turn's closing reply (`isProseReply`), and an assistant row is what draws the
 * summary under it without a caption.
 */
export default function CompactionMarker({ marker, resolveModelLabel }: CompactionMarkerProps) {
  const { t, i18n } = useTranslation('chat');

  // ── The wire: the marker's fields, read off its row. Everything below it is composition. ──
  const { trigger, summarizerModel, summarizerServed, summarizerEffort, preTokens, postTokens, summarizerTokensIn, summarizerTokensOut, chunks, at } = marker;

  // The model that answered, by the catalog's name for it, as a reply's caption names its model. When the
  // catalog does not know it, or no reply named one, the `[summarizer]` word stands in.
  const modelLabel = (summarizerServed && resolveModelLabel?.(summarizerServed)) || summarizerModel;

  const swappedAt = new Date(at);
  const swappedAtLabel = Number.isNaN(swappedAt.getTime()) ? undefined : swappedAt.toLocaleString(i18n.language);

  const before = preTokens === null ? null : formatTokenCount(preTokens);
  const after = postTokens === null ? null : formatTokenCount(postTokens);
  // Before and after in one figure. A context never measured before drops its half, and an after still
  // to come holds its place, so the line keeps its shape when the history row brings the figure in.
  const contextFact = before !== null
    ? (
      <>
        <Trans
          t={t}
          i18nKey={after !== null ? 'compaction.context' : 'compaction.contextPending'}
          values={{ before, after }}
          components={{ to: <ToArrow /> }}
        />
        {after === null && <span className="sr-only">{` ${t('compaction.afterPending')}`}</span>}
      </>
    )
    : after !== null
      ? t('compaction.contextAfterOnly', { after })
      : null;

  const triggerKey = TRIGGER_KEYS[trigger];
  const whyFacts = [triggerKey ? t(triggerKey) : null, contextFact].filter((fact) => fact !== null);
  const workFacts = [
    <Trans
      key="by"
      t={t}
      i18nKey="compaction.summarizedBy"
      values={{ model: modelLabel, effort: summarizerEffort }}
      // A model's name is one word: `claude-haiku-5-5` broken at a hyphen reads as two.
      components={{ model: <span className="whitespace-nowrap" /> }}
    />,
    t('compaction.read', { tokens: formatTokenCount(summarizerTokensIn) }),
    t('compaction.wrote', { tokens: formatTokenCount(summarizerTokensOut) }),
    chunks > 1 ? t('compaction.parts', { count: chunks }) : null,
  ].filter((fact) => fact !== null);

  return (
    <div
      data-compaction-marker={trigger}
      data-compaction-after={postTokens === null ? 'pending' : 'known'}
      data-compaction-chunks={chunks}
      className="py-1"
    >
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
        <p
          title={swappedAtLabel}
          className="flex min-w-0 items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
        >
          <Shrink aria-hidden="true" className="h-3.5 w-3.5 flex-none" />
          {/* Centred, so on a phone too narrow for one line the label wraps like the facts under it. */}
          <span className="min-w-0 text-center">{t('compaction.heading')}</span>
        </p>
        <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
      </div>
      <FactLine facts={whyFacts} className="mt-1.5 text-balance text-center text-xs text-muted-foreground" />
      <FactLine facts={workFacts} className="mt-0.5 text-balance text-center text-[11px] text-muted-foreground" />
    </div>
  );
}
