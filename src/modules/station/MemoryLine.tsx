import type { TFunction } from 'i18next';
import type { ReactNode, TransitionEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { stationStamp } from '@/modules/station/stationClock';
import type { CompanionMemoryLine } from '@/shared/companion-types';
import { CardFoldBody, Collapsible, CollapsibleTrigger, FoldChevron } from '@/shared/ui';

/**
 * When he said it, on his clock, in the spelling her `whenWords` gives a moment: "today 4:34 PM", "yesterday 7:34 PM", then
 * the page's one spelling of a day ("Oct 26"; `stationStamp` cuts it, the locale's clock and all). Null for a memory that records
 * no moment.
 */
function momentOf(saidAt: string | null, t: TFunction): string | null {
  const stamp = saidAt === null ? null : stationStamp(saidAt);
  if (stamp === null) return null;
  if (stamp.day === 'today') return t('station.memory.when.today', { clock: stamp.clock, defaultValue: 'today {{clock}}' });
  if (stamp.day === 'yesterday') return t('station.memory.when.yesterday', { clock: stamp.clock, defaultValue: 'yesterday {{clock}}' });
  return stamp.date;
}

type MemoryLineProps = {
  line: CompanionMemoryLine;
  /** Its kind, drawn by the corner from its one map of kinds: the glyph beside the word. */
  kind: ReactNode;
  /** His words stand open under it. */
  open: boolean;
  /** The line pressed: `true` opens its words, `false` folds them. */
  onOpenChange: (open: boolean) => void;
};

/**
 * ONE MEMORY OF THE CORNER, A DISCLOSURE (`button`, `aria-expanded`), drawn as the left rail draws a fold: the house's chevron,
 * then its title in the ink and under it its kind and the moment he said it in the muted ink, the rail's own reading order
 * (a session's name over its project, a feature's title over its step). Its press opens his first words under it ("You
 * said", then his words as the line carries them, cut at 200 characters), in place and never onto the stage; a second press
 * folds them. It works the same under a finger and a pointer, so no tooltip carries his words, and below 768 px it is a 44 px
 * catch (the touch law). Nothing of hers stands as his: the words shown are the line's `quote` alone.
 *
 * His words, once their fold has finished opening, are brought into the nearest scroller's view: a line at the foot of the
 * short list would otherwise open out of sight. A line drawn already open ran no transition and moves nothing.
 *
 * Used by this module's `MemoryCornerView`, once per line of her memory.
 */
export function MemoryLine({ line, kind, open, onOpenChange }: MemoryLineProps) {
  const { t } = useTranslation();
  const moment = momentOf(line.saidAt, t);
  const reveal = (event: TransitionEvent<HTMLLIElement>) => {
    if (open && event.propertyName === 'grid-template-rows') event.currentTarget.scrollIntoView({ block: 'nearest' });
  };

  return (
    <li data-station-memory-line={line.token} onTransitionEnd={reveal} className="min-w-0">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          className="relative flex w-full min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-quick hover:bg-muted/60 focus-visible:-outline-offset-2 finger:min-h-11"
        >
          <FoldChevron collapsed={!open} className="mt-[3px] text-sm text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="break-words text-sm font-medium leading-5 text-foreground">{line.title}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted-foreground">
              {kind}
              {moment !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  <time dateTime={line.saidAt ?? undefined} className="whitespace-nowrap tabular-nums">{moment}</time>
                </>
              )}
            </span>
          </span>
        </CollapsibleTrigger>
        <CardFoldBody>
          {/* Set in under the title (the row's 10 px, the sign's 14 px and its 10 px gap), so his words hang from the line. */}
          <div data-station-memory-words="" className="mb-1.5 ml-[34px] mr-2.5 mt-0.5 rounded-md border border-border bg-background px-2.5 py-2">
            {line.quote === null ? (
              <p className="text-xs leading-snug text-muted-foreground">
                {t('station.memory.noWords', { defaultValue: 'No words of yours are kept with this one.' })}
              </p>
            ) : (
              <>
                <p className="text-xs leading-4 text-muted-foreground">{t('station.memory.youSaid', { defaultValue: 'You said' })}</p>
                <p className="mt-1 break-words text-[13px] leading-relaxed text-foreground">
                  {t('station.memory.quoted', { quote: line.quote, defaultValue: '“{{quote}}”' })}
                </p>
              </>
            )}
          </div>
        </CardFoldBody>
      </Collapsible>
    </li>
  );
}
