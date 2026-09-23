import { useTranslation } from 'react-i18next';

import { ArcDeck } from '@/modules/plan-runner/ArcDeck';
import { useArcs } from '@/modules/plan-runner/hooks/useArcs';
import { cn } from '@/shared/utils';

/**
 * Every arc on the lane, one deck each, one under another — the gallery the Runner tab opens on,
 * above the run list. Each deck is a full-width row because each is itself a horizontal strip of
 * cards: two decks side by side would halve the strip a card needs.
 *
 * IT DRAWS EXACTLY WHAT `useArcs` HANDS IT. A finished arc leaves on the run list's own schedule
 * because the server's snapshot drops a complete arc past `ENDED_KEEP_S`, exactly as it drops a
 * finished run; the gallery adds no age rule of its own, so the two lists can never disagree
 * about what "recent" means.
 *
 * NOTHING AT ZERO ARCS — not an empty frame, not a heading over nothing. An operator with no arc
 * sees the Runner tab exactly as it was before arcs existed.
 *
 * ONE GALLERY, TWO HOMES — the run card's two, and for the same reason. `home` is its one variance
 * and it changes only the frame, never the deck: the TAB centres a measured `max-w-2xl` column with
 * its own inset, as the run list under it does; the GUTTER is flush, because the widget card around
 * it already owns the inset and the column is the width there is. In the gutter each card also
 * takes the strip's whole width (`ArcDeck`'s `cardFillsStrip`): a column is 300px at its floor, less
 * than one 18rem card and its insets, so a fixed width would be clipped at one width and leave a
 * neighbour half in view at another — one whole card per view, paged by the arrows, is the shape
 * that holds at every width the column takes. The heading stays in both homes, in the gutter the
 * way the Memory widget heads its own sections. The home is written on the DOM
 * (`data-arc-gallery="tab|gutter"`) so a probe can tell the two apart.
 *
 * Used by `RunnerPanel` above its run list (the tab home), and by `RunnerWidgetBody` above the
 * gutter widget's runs (the gutter home).
 */
export function ArcGallery({ home = 'tab' }: { home?: 'tab' | 'gutter' }) {
  const { t } = useTranslation();
  const { arcs } = useArcs();

  if (arcs.length === 0) return null;

  return (
    <section
      data-arc-gallery={home}
      className={cn(
        'flex w-full min-w-0 flex-col gap-2',
        home === 'tab' && 'mx-auto max-w-2xl px-4 pt-5',
      )}
    >
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('runner.arcs')}</h3>
      <ul className="flex min-w-0 flex-col gap-4">
        {arcs.map((arc) => (
          <li key={arc.arc} className="min-w-0">
            <ArcDeck arc={arc} cardFillsStrip={home === 'gutter'} />
          </li>
        ))}
      </ul>
    </section>
  );
}
