import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { StationLanded } from '@/shared/station-types';
import { FoldChevron, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

type LandedEntryProps = {
  /** The landing. Its title and the chat it came from are read here; its kind and its time arrive drawn, below. */
  entry: StationLanded;
  /** Its kind as the strip draws it: the kit `Badge` with the kind's glyph and word, from the strip's one map of kinds. Not drawn on one line. */
  badge: ReactNode;
  /** When it landed, in the strip's words on his clock: "14:02", "yesterday 19:34", "Oct 26". */
  when: string;
  /** It landed after his last look: the warm edge for the eye, and the word "New" for a screen reader. */
  fresh: boolean;
  /**
   * For a landing no stage can hold (a recovered check names none), the fold its press works: whether its whole line
   * stands open under the strip, and that line's id (`aria-controls`). `null` for a landing whose press puts it on the
   * stage.
   */
  fold: { open: boolean; line: string } | null;
  /** One line, for the folded strip's newest landing: its title with its time after it, and no line of who did it and what kind. */
  oneLine?: boolean;
  /** Whether its press is a tab stop: the timeline gives its week one (the rest are reached by ←/→). Left out, it is one. */
  tabbable?: boolean;
  /** The press: the stage, or the fold, as the strip decides. */
  onPress: () => void;
};

/**
 * ONE LANDING ON THE STRIP, AND THE PRESS IT IS. A box on two lines: over, when it landed (on his clock), who did it
 * ("by <chat>", or "by the house" when no session did), both in the muted ink, and its kind's badge at the end; under,
 * its title on one line, the whole width of the box. Below 768 px, where the box is too narrow for the three, the badge
 * takes a line of its own between them. A press puts a shipped feature, an epic or a chat's landing on the
 * stage, where the title stands whole; a recovered check, which no stage can hold, opens its whole line in place under
 * the strip instead (`aria-expanded`, the box drawn pressed while it stands open), and a second press folds it. Such a
 * landing says so before it is pressed: the house's fold chevron ends its title, turned while its line stands open.
 *
 * ON ONE LINE (`oneLine`), the folded strip's newest: its title, and after it its time in the muted ink, so even the
 * folded "nothing new" line says what last landed and when. The press, the warm edge, "New" and the chevron are the same.
 *
 * NEW, for a landing after his last look, is said twice and never in colour alone (MAN-578): the garnish edge, the
 * station's warm token, for the eye; the word "New", first in the press's name, for a screen reader. The timeline's
 * rule says it a third time, by where it stands.
 *
 * THE TOUCH LAW. The box is a 44 px catch below 768 px. The title it cuts is whole on the stage its press opens, or in
 * place; the `Tooltip` only repeats it for a pointer, and at once for a keyboard's focus. Where there is no hover
 * (`(hover: none)`: a phone) the bubble is never drawn: a tap raises the compatibility mouse events that would leave it standing
 * over the stage head or the line the press just opened.
 *
 * A pure view that positions nothing: the strip sets its width. Drawn by `SinceYouLastLookedView` (this module): each
 * landing of the timeline, and the newest alone on the folded line.
 */
export function LandedEntry({ entry, badge, when, fresh, fold, oneLine = false, tabbable = true, onPress }: LandedEntryProps) {
  const { t } = useTranslation();
  const by = entry.chat === null
    ? t('station.strip.byHouse', { defaultValue: 'by the house' })
    : t('station.strip.by', { chat: entry.chat, defaultValue: 'by {{chat}}' });
  const isNew = fresh && <span className="sr-only">{t('station.strip.new', { defaultValue: 'New' })}</span>;
  const title = <span data-landed-title="" className="min-w-0 flex-1 truncate text-sm leading-5 text-foreground">{entry.title}</span>;
  const chevron = fold !== null && <FoldChevron collapsed={!fold.open} className="text-sm text-muted-foreground" />;

  return (
    // A column, so the tooltip's box around the press stretches to the width the strip gives, and the title cuts there.
    <div data-landed-entry={entry.id} data-landed-kind={entry.kind} data-landed-new={fresh ? '' : undefined} className="flex min-w-0 flex-col">
      <Tooltip content={entry.title} position="bottom" showOnFocus className="max-w-[min(24rem,90vw)] whitespace-normal [@media(hover:none)]:hidden">
        <button
          type="button"
          aria-expanded={fold?.open}
          aria-controls={fold?.open ? fold.line : undefined}
          tabIndex={tabbable ? 0 : -1}
          className={cn(
            'flex w-full min-w-0 rounded-md border bg-card px-2.5 py-1 text-left transition-colors hover:bg-muted focus-visible:-outline-offset-2 aria-expanded:bg-muted finger:min-h-11',
            oneLine ? 'items-center gap-2' : 'flex-col items-start justify-center gap-0.5',
            fresh ? 'border-garnish' : 'border-border',
          )}
          onClick={onPress}
        >
          {oneLine ? (
            <>
              {isNew}
              {title}
              <span className="shrink-0 text-xs tabular-nums leading-4 text-muted-foreground">{when}</span>
              {chevron}
            </>
          ) : (
            <>
              {/* Who did it grows from nothing (`flex-1`), so on a desk the line never wraps and the kind ends it; below
                  768 px the kind takes a line of its own, where the box is too narrow for the three, and the time and who keep theirs. */}
              <span className="flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs leading-4 text-muted-foreground">
                {isNew}
                <span className="shrink-0 tabular-nums">{when}</span>
                <span aria-hidden="true">·</span>
                <span className="min-w-0 flex-1 truncate">{by}</span>
                <span className="flex max-md:w-full">{badge}</span>
              </span>
              <span className="flex w-full min-w-0 items-center gap-1">
                {title}
                {chevron}
              </span>
            </>
          )}
        </button>
      </Tooltip>
    </div>
  );
}
