import { ChevronRight } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { useActionLapse } from '@/modules/companion/hooks/useActionLapse';
import { ACTION_SENTENCE, hourMinute } from '@/modules/companion/utils/actionWords';
import type { CompanionPendingAction } from '@/shared/companion-types';
import { Button } from '@/shared/ui';

type CompanionActionLineProps = {
  /** The one action waiting for his word, as her picture holds it: the action the whole card draws. */
  pending: CompanionPendingAction;
  /** Opens the whole card, where his lines stand word for word: the phone selects Needs you. */
  onOpen(): void;
};

/** The words around the action, in the tone's ink and the caption's size: the card's head and its lapse. */
const LABEL = 'text-xs text-tone-ink';

/**
 * The action waiting for his word, in one line: the card's head, its action and its lapse, sharing the card's deadline.
 * Consumed by the station module's phone arrangement, which stands it just above its bottom bar (and the round talk button
 * he answers by) while an action waits, so what waits is in sight from every section; keyed by `pending.id`, as the card is.
 *
 * THE CARD IN ONE LINE (CompanionActionCard, drawn smaller): the waiting mark and "Waiting for your word" in the warn tone;
 * the action as the card's sentence — "Queue **Lane drag**", the target in the weight of the thing acted on; and "Lapses at
 * 14:07", in the 24-hour clock she says it in. The words are the card's (`utils/actionWords.ts`, `companion.action.*`), so the
 * two say the same thing; like the card, it gives him no phrase to say: there is none (she reads the action back and judges
 * from the conversation whether he agreed). ONE LINE, giving way at its end: the lapse first and whole (it wraps into a
 * second row the line clips, so a time is never cut to "Lapses at 1…"), then the sentence, cut with an ellipsis, the head
 * last. A reader hears it whole: all of it is the press's name. MEASURED UPRIGHT: the row is 326 px at 390 (296 at 360),
 * the head with its dot takes about 131 of it and the lapse about 93, so the lapse stands only beside a sentence of about
 * 100 px — none of `FAKE_PANEL`'s seven ("Queue Lane drag" alone is 114) — and a long verb cuts its target ("Close the
 * follow-up on Rete…" at 390; at 360 the target is gone). On its side (844 px) every fixture's line stands whole.
 *
 * THE WHOLE LINE IS ONE PRESS calling `onOpen`, its arrow saying it opens: the whole card stands there with the prompt, the
 * Withdraw × and his carried lines. The line NEVER carries his lines (MAN-9186: they travel word for word, so they stand only
 * whole, in the card). 36 px tall, a 44 px catch below 768 px and under a finger (the station's touch law). Painted in the
 * tone's wash with a rule of the card's border over it (the wash alone barely parts from a light canvas), square at the
 * glass's edges; the caller places it. The kit's `link` button: a line of words that opens something, so a mouse's hover
 * underlines them and keeps the wash (the ghost's hover would paint the accent's green over the amber), and a press neither
 * lifts nor shrinks a strip the glass's width.
 *
 * THE LAPSE IS THE CARD'S DEADLINE (`useActionLapse(pending.expiresAt)`): once it passes the line draws nothing, as the card
 * does, so the two lapse together; an action already past its time is never drawn.
 */
export function CompanionActionLine({ pending, onOpen }: CompanionActionLineProps) {
  const { t } = useTranslation();
  const lapsed = useActionLapse(pending.expiresAt);

  if (lapsed) return null;

  const sentence = ACTION_SENTENCE[pending.action];

  return (
    <Button
      type="button"
      variant="link"
      data-tone="warn"
      data-companion-action-line={pending.action}
      data-companion-action-line-target={pending.target.kind}
      onClick={onOpen}
      // The rule over it spelled whole: the kit's `border: none` leaves no style to draw, and every side's width at `medium`.
      className="h-auto min-h-9 w-full justify-start gap-2 rounded-none border-0 border-t border-solid border-tone-ink/40 bg-tone-soft px-3 py-1.5 text-left font-normal text-foreground max-md:min-h-11 [@media(pointer:coarse)]:min-h-11"
    >
      <span aria-hidden="true" className="vv-pulse size-2 shrink-0 rounded-full bg-tone-ink" />
      {/* One row of 20 px, clipped: the lapse wraps into a second row out of sight when the words before it leave it no
          room, and the head and the sentence, alone on the row, are cut with an ellipsis at their end. */}
      <span data-companion-action-line-row="" className="flex h-5 min-w-0 flex-1 flex-wrap items-baseline overflow-hidden leading-5">
        <span className="min-w-0 max-w-full truncate">
          <span data-companion-action-line-head="" className={`${LABEL} font-medium`}>{t('companion.action.waiting', 'Waiting for your word')}</span>
          <span className={LABEL}> · </span>
          <span data-companion-action-line-what="">
            <Trans
              t={t}
              i18nKey={sentence.key}
              defaults={sentence.english}
              // The name rides as the slot's own child, so a name holding "<" reads as written.
              components={{ target: <strong className="font-semibold">{pending.target.spoken}</strong> }}
            />
          </span>
        </span>
        <span data-companion-action-line-tail="" className={`${LABEL} whitespace-pre`}>
          {' · '}
          <time data-companion-action-line-lapse="" dateTime={pending.expiresAt}>
            {t('companion.action.lapses', { time: hourMinute(pending.expiresAt), defaultValue: 'Lapses at {{time}}' })}
          </time>
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="text-tone-ink" />
    </Button>
  );
}
