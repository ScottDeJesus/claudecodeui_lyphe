import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';

/** From this many turns up the rail is drawn: fewer are in sight at once and need no way round. */
const TURNS_SHOWN_FROM = 4;

/** The most marks the rail draws: the newest turns, so the rail never grows past the room over the core. */
const MOST_MARKS = 14;

type TurnRailProps = {
  /** The transcript's scroller: the reader's own lines are found in it (`data-chat-your-line`), and the rail scrolls it. */
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** How many messages the transcript holds: when it changes, the turns are counted again. */
  messageCount: number;
};

/**
 * THE RAIL OF TURNS, in the strip over the chat's core: one small mark for each line the reader sent, oldest at the top. The mark of the turn
 * that is in view is lit. A press on a mark brings that turn's own line to the top of the talk. It is the way round a long chat without
 * dragging through it, and it says at a glance how far down the talk the reader is.
 *
 * Drawn from four turns up, and only where the chat's column has the strip (`chatLine.css` hides it in a narrow column). Of a very long chat
 * it draws the newest turns. The turns are read off the transcript itself (each of the reader's lines is marked `data-chat-your-line`,
 * mounted or not), so the rail holds no list of its own; which one is in view is the last whose line has passed the top third of the scroller,
 * and the last of all at the talk's foot.
 *
 * `data-chat-rail` marks it. Used by `ChatComposer`, in the line's row beside the core.
 */
export function TurnRail({ scrollerRef, messageCount }: TurnRailProps) {
  const { t } = useTranslation('chat');
  // How many turns the talk holds, and which is in view (by place among them). State, because the marks are drawn from both; each is
  // read off the scroller, when the messages change and as the reader scrolls.
  const [turns, setTurns] = useState(0);
  const [inView, setInView] = useState(-1);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const read = () => {
      const lines = scroller.querySelectorAll<HTMLElement>('[data-chat-your-line]');
      const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
      let at = -1;
      lines.forEach((element, index) => {
        if (element.getBoundingClientRect().top <= line) at = index;
      });
      // At the foot of the talk the last turn is the one in view, however short it is.
      const atFoot = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      setTurns(lines.length);
      setInView(lines.length === 0 ? -1 : atFoot ? lines.length - 1 : Math.max(0, at));
    };
    read();
    scroller.addEventListener('scroll', read, { passive: true });
    return () => scroller.removeEventListener('scroll', read);
  }, [scrollerRef, messageCount]);

  if (turns < TURNS_SHOWN_FROM) return null;
  const first = Math.max(0, turns - MOST_MARKS);
  const go = (index: number) => {
    scrollerRef.current?.querySelectorAll<HTMLElement>('[data-chat-your-line]')[index]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <nav data-chat-rail="" aria-label={t('rail.label', { defaultValue: 'Turns' })} className="chat-line__rail flex-col items-center">
      {Array.from({ length: turns - first }, (_, offset) => {
        const index = first + offset;
        const lit = index === inView;
        const label = t('rail.turn', { defaultValue: 'Turn {{n}}', n: index + 1 });
        return (
          <button
            key={index}
            type="button"
            data-chat-rail-mark={lit ? 'lit' : ''}
            aria-label={label}
            aria-current={lit ? 'true' : undefined}
            title={label}
            onClick={() => go(index)}
            className="group grid h-3.5 w-7 place-items-center outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className={cn(
                'block h-px transition-all duration-150 group-hover:w-4 group-hover:bg-foreground',
                lit ? 'h-0.5 w-4 bg-accent-ink' : 'w-2 bg-muted-foreground/60',
              )}
            />
          </button>
        );
      })}
    </nav>
  );
}
