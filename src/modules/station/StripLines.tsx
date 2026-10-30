import { CalendarClock, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type StripLineProps = {
  /** What the strip draws: `reading`, `failed`, `quiet`, `timeline` or `folded`. */
  state: string;
  /** How many landings are new, once landings are drawn. */
  fresh?: number;
  /** The line itself. */
  children: ReactNode;
  /** What stands open under the line, its whole width: a recovered landing's whole line. */
  below?: ReactNode;
};

/**
 * The strip's frame in every state: one line across the bar's middle, named "Since you last looked" for a screen reader,
 * its state in `data-station-strip` and how many landings are new in `data-strip-fresh`, with what stands open under it
 * (`below`). Used by `SinceYouLastLookedView` and by the plain lines below (this module).
 */
export function StripLine({ state, fresh, children, below }: StripLineProps) {
  const { t } = useTranslation();
  return (
    <section
      data-station-strip={state}
      data-strip-fresh={fresh}
      aria-label={t('station.strip.name', { defaultValue: 'Since you last looked' })}
      className="flex min-w-0 flex-1 flex-col gap-1.5"
    >
      <div className="flex min-w-0 items-center gap-2">{children}</div>
      {below}
    </section>
  );
}

/**
 * While the first read is out: quiet placeholders where landings will stand, and "Reading what landed…" for a screen
 * reader. Each is the shape of what replaces it, so nothing below the bar moves as the week arrives: folded, the one-line
 * press; open, three of the timeline's boxes, their rows as `LandedEntry` draws them (the time line as tall as the kind's
 * badge on it, below 768 px the badge's own line, the title). Drawn by `SinceYouLastLookedView` (this module).
 */
export function StripReadingLine({ folded }: { folded: boolean }) {
  const { t } = useTranslation();
  return (
    <StripLine state="reading">
      <span role="status" className="sr-only">{t('station.strip.loading', { defaultValue: 'Reading what landed…' })}</span>
      <div aria-hidden="true" className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
        {folded ? (
          <div className="vv-skeleton w-56 shrink-0 rounded-md border border-transparent px-2.5 py-1 max-md:min-h-11">
            <span className="block h-5" />
          </div>
        ) : (
          [0, 1, 2].map((slot) => (
            <div key={slot} className="vv-skeleton flex w-44 shrink-0 flex-col gap-0.5 rounded-md border border-transparent px-2.5 py-1">
              <span className="block h-[18px] max-md:h-4" />
              <span className="hidden h-[18px] max-md:block" />
              <span className="block h-5" />
            </div>
          ))
        )}
      </div>
    </StripLine>
  );
}

/** A week with nothing landed in it: "Nothing has landed this week". Drawn by `SinceYouLastLookedView` (this module). */
export function StripQuietLine() {
  const { t } = useTranslation();
  return (
    <StripLine state="quiet">
      <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <CalendarClock aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate">{t('station.strip.quiet', { defaultValue: 'Nothing has landed this week' })}</span>
      </p>
    </StripLine>
  );
}

/**
 * A read that failed, in the warn tone (errors are amber, MAN-577) with its glyph and its words, never colour alone: "Couldn't
 * read what landed", the failure's own words after it in the muted ink, and Try again, a 44 px catch below 768 px. Below
 * 768 px, where the strip has a line of its own, the words wrap to two lines rather than cut the failure away. Said at
 * once to a screen reader (`role="alert"`). Drawn by `SinceYouLastLookedView` (this module).
 */
export function StripFailedLine({ failure, onReread }: { failure: string; onReread: () => void }) {
  const { t } = useTranslation();
  return (
    <StripLine state="failed">
      <p role="alert" data-tone="warn" className="flex min-w-0 items-center gap-2 text-sm text-tone-ink">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        <span className="truncate max-md:line-clamp-2 max-md:whitespace-normal">
          {t('station.strip.failed', { defaultValue: 'Couldn’t read what landed' })}
          <span className="text-muted-foreground"> · {failure}</span>
        </span>
      </p>
      <Button variant="outline" size="sm" data-strip-retry="" className="shrink-0 max-md:h-11" onClick={onReread}>
        {t('station.strip.retry', { defaultValue: 'Try again' })}
      </Button>
    </StripLine>
  );
}
