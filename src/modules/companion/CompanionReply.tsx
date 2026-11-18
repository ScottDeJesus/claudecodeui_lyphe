import { Fragment, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionSentence } from '@/modules/companion/CompanionSentence';
import { useWordsInTime } from '@/modules/companion/hooks/useWordsInTime';
import type { CompanionLogEntry } from '@/shared/companion-types';
import type { CompanionSentenceRef } from '@/shared/types';
import { cn } from '@/shared/utils';

type CompanionReplyProps = {
  /** The sentences of one turn, ordered by their index. Empty while she is answering and none has landed: the dots stand alone. */
  sentences: CompanionLogEntry[];
  /** The turn the sentences belong to (null for one with no turn), which `speaking` is matched against. */
  turnId: string | null;
  /** Whether she is still answering this turn: the breathing dots end the paragraph. */
  answering: boolean;
  /** The sentence this page's player is sounding: marked in the paragraph. Null, no sentence is marked. */
  speaking: CompanionSentenceRef | null;
  /** Her name, for the dots' words. */
  name: string;
  /** The place's own type and alignment, laid over the log's (`text-sm leading-relaxed`). */
  className?: string;
};

/**
 * The sentence being spoken, as read-aloud marks it: a highlighter's band in the info tone (the status line's Speaking),
 * its ink at a fifth, widened by a ring of the same band so the words keep their places (a ring takes no room; padding
 * would re-wrap the paragraph each time the mark moves), with a 2px bar of the tone's full ink in the ring's left edge,
 * and all of it cloned onto every line the sentence wraps over. The bar is what meets the house's 3:1 floor for a mark:
 * 5.3:1 against the canvas in light and 10.3:1 in dark, 4.3:1 and 6.8:1 against the band beside it, where the band alone
 * measures 1.32:1 and 1.51:1 (the tone's own soft ground, 1.07:1, vanished in light); the words on the band keep 12.6:1
 * and 11.0:1. The bar is a shadow, as the ring is, so it too takes no room; drawn under the ring's fifth of the same ink,
 * it reads as the full ink. An underline was tried and read as a link. Forced colours drop every ground and shadow, so
 * there the words are underlined instead.
 */
const SPEAKING_MARK =
  'rounded-sm bg-tone-ink/20 ring-2 ring-tone-ink/20 shadow-[-2px_0_0_0] shadow-tone-ink box-decoration-clone forced-colors:underline';

/**
 * The three dots of a turn still being said; the words are for a screen reader, the dots for the eye. Used by this module's
 * CompanionReply (the end of her paragraph) and CompanionLog (its waiting row, before the first sentence has landed).
 */
export function SpeakingDots({ label }: { label: string }) {
  return (
    <span data-companion-speaking="" className="ml-1 inline-flex items-center gap-0.5 align-middle">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          aria-hidden="true"
          className="size-1 rounded-full bg-muted-foreground motion-safe:animate-pulse"
          style={{ animationDelay: `${dot * 160}ms` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * A turn as one paragraph: its sentences joined, each sound a small mark at its offset (CompanionSentence), the sentence the
 * voice is sounding on a band of the info tone (`SPEAKING_MARK`) and, while the turn is still being answered, the breathing dots
 * after the last word. Every sentence is a span of its own, bare unless it is the one being spoken, so the paragraph's lines
 * never re-wrap as the mark moves and a sentence is the same element before, while and after it is said.
 *
 * A SENTENCE THAT LANDS COMES IN A WORD AT A TIME, IN TIME WITH THE VOICE (`useWordsInTime` says how, and what it does on a page
 * with no voice). The server sends an answer a whole sentence at a time; a sentence this paragraph has not drawn before is an
 * arriving one for as long as the paragraph stands. What was already there when the paragraph was first drawn stands whole, so a
 * transcript opened on old turns does not replay them; the one exception is the newest sentence of a turn still being answered,
 * which has only just landed (the station's line is drawn afresh for each turn, with that sentence already in it). The words
 * come in where they will stand, so nothing re-wraps and the pane's following of the end is unchanged.
 *
 * Used by this module's CompanionLog (each turn, under its caption) and by the station's portrait view (the latest turn
 * alone), so the panel, the log and the station's line draw one paragraph.
 */
export function CompanionReply({ sentences, turnId, answering, speaking, name, className }: CompanionReplyProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  // The sentences this paragraph has drawn, and those of them that landed while it stood.
  const [arrivals, setArrivals] = useState<{ seen: ReadonlySet<number>; landed: ReadonlySet<number> }>(() => ({
    seen: new Set((answering ? sentences.slice(0, -1) : sentences).map((sentence) => sentence.id)),
    landed: new Set(),
  }));
  // State that follows a prop, set during the render the sentences arrive in: their words are cut before they are first painted.
  const fresh = sentences.filter((sentence) => !arrivals.seen.has(sentence.id)).map((sentence) => sentence.id);
  if (fresh.length > 0) setArrivals({ seen: new Set([...arrivals.seen, ...fresh]), landed: new Set([...arrivals.landed, ...fresh]) });
  useWordsInTime(rootRef, [...arrivals.landed].join(' '));
  return (
    <div ref={rootRef} className={cn('break-words text-sm leading-relaxed text-foreground', className)}>
      {sentences.map((sentence, index) => {
        const spoken = speaking !== null && turnId === speaking.turnId && sentence.index === speaking.index;
        const arriving = arrivals.landed.has(sentence.id);
        return (
          <Fragment key={sentence.id}>
            {index > 0 && ' '}
            <span
              data-companion-speaking-sentence={spoken ? '' : undefined}
              data-tone={spoken ? 'info' : undefined}
              data-companion-arriving-sentence={arriving ? sentence.id : undefined}
              data-turn={arriving ? turnId ?? '' : undefined}
              data-index={arriving ? sentence.index ?? '' : undefined}
              className={spoken ? SPEAKING_MARK : undefined}
            >
              <CompanionSentence text={sentence.text} sounds={sentence.sounds} arriving={arriving} />
            </span>
          </Fragment>
        );
      })}
      {answering && <SpeakingDots label={t('companion.log.speaking', { name })} />}
    </div>
  );
}
