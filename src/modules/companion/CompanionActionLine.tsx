import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

/** Where each action's sentence (`ACTION_SENTENCE`) names its target, the slot the card's `Trans` fills. */
const TARGET_SLOT = '<target/>';

/**
 * The action waiting for his word, in one line: the card's head, its action and its lapse, sharing the card's deadline.
 * Consumed by the station module's phone arrangement, which stands it just above its bottom bar (and the round talk button
 * he answers by) while an action waits, so what waits is in sight from every section; keyed by `pending.id`, as the card is.
 *
 * THE CARD IN ONE LINE (CompanionActionCard, drawn smaller): the waiting mark and its head in the warn tone; the action as the
 * card's sentence — "Queue **Lane drag**", the target in the weight of the thing acted on; and "Lapses at 14:07", in the 24-hour
 * clock she says it in. The words are the card's (`utils/actionWords.ts`, `companion.action.*`), so the two say the same thing;
 * like the card, it gives him no phrase to say: there is none (she reads the action back and judges from the conversation
 * whether he agreed). A line that waits for his word says first what it waits on, so in order:
 *   1. ITS HEAD, the mark and "Waiting" — "Waiting for your word" only where the line is 30rem across (a phone on its side), read
 *      off the line's own width (its row is the query container) — with the full words always its name;
 *   2. THE VERB AND THE TARGET, whole when they fit; where they do not, the verb gives way (cut with an ellipsis) before the
 *      target, which is cut last, so two like actions never read the same ("Close the fol… Retention emails");
 *   3. THE LAPSE, where room remains: it wraps into a second row the line clips when the words before it leave it no room, so a
 *      time is never cut to "Lapses at 1…" and never takes the target's room.
 * A reader hears it whole: all of it is the press's name. MEASURED UPRIGHT (the row 326 px at 390, 296 at 360): the head was
 * about 131 px of the row with its full words and the lapse about 93, so a long verb cut its target ("Close the follow-up on
 * Rete…" at 390; at 360 the target was gone); "Waiting" is about 50, and the card, one press away, holds the whole and its lapse.
 *
 * THE WHOLE LINE IS ONE PRESS calling `onOpen`, its arrow saying it opens: the whole card stands there with the prompt, the
 * Withdraw × and his carried lines. The line NEVER carries his lines (MAN-9186: they travel word for word, so they stand only
 * whole, in the card). 36 px tall, a 44 px catch under a finger (the station's touch law: a touch screen, or a window under
 * 768 px). Painted in the tone's wash with a rule of the card's border over it (the wash alone barely parts from a light
 * canvas), square at the glass's edges; the caller places it. The kit's `link` button: a line of words that opens something, so a mouse's hover
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

  // The card's sentence, split at its target so the verb can give way before it: each sentence names its target once.
  const sentence = ACTION_SENTENCE[pending.action];
  const words = t(sentence.key, { defaultValue: sentence.english });
  const at = words.indexOf(TARGET_SLOT);
  const verb = (at < 0 ? words : words.slice(0, at)).trim();
  const after = at < 0 ? '' : words.slice(at + TARGET_SLOT.length).trim();
  const fullHead = t('companion.action.waiting', 'Waiting for your word');

  return (
    <Button
      type="button"
      variant="link"
      data-tone="warn"
      data-companion-action-line={pending.action}
      data-companion-action-line-target={pending.target.kind}
      onClick={onOpen}
      // The rule over it spelled whole: the kit's `border: none` leaves no style to draw, and every side's width at `medium`.
      className="h-auto min-h-9 w-full justify-start gap-2 rounded-none border-0 border-t border-solid border-tone-ink/40 bg-tone-soft px-3 py-1.5 text-left font-normal text-foreground finger:min-h-11"
    >
      <span aria-hidden="true" className="vv-pulse size-2 shrink-0 rounded-full bg-tone-ink" />
      {/* One row of 20 px, clipped, its own width the query container: the lapse wraps into a second row out of sight when the
          words before it leave it no room, and the head and the action, alone on the row, give way verb first. */}
      <span data-companion-action-line-row="" className="flex h-5 min-w-0 flex-1 flex-wrap items-baseline overflow-hidden leading-5 [container-type:inline-size]">
        <span className="flex min-w-0 max-w-full items-baseline gap-x-1">
          <span data-companion-action-line-head="" className={`${LABEL} shrink-0 font-medium`}>
            <span aria-hidden="true" className="[@container(min-width:30rem)]:hidden">{t('companion.action.waitingShort', 'Waiting')}</span>
            <span aria-hidden="true" className="hidden [@container(min-width:30rem)]:inline">{fullHead}</span>
            <span className="sr-only">{fullHead}</span>
          </span>
          <span className={`${LABEL} shrink-0`}>·</span>
          <span data-companion-action-line-what="" className="flex min-w-0 items-baseline gap-x-1">
            {verb !== '' && <span data-companion-action-line-verb="" className="min-w-[3ch] shrink-[1000] truncate">{verb}</span>}
            {/* The name rides as an element's own child, so a name holding "<" reads as written. */}
            <strong data-companion-action-line-object="" className="min-w-0 truncate font-semibold">{pending.target.spoken}</strong>
            {after !== '' && <span className="min-w-[3ch] shrink-[1000] truncate">{after}</span>}
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
