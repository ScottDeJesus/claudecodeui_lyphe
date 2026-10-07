import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { RoadmapTreeFace } from '@/modules/roadmap/RoadmapTreeFace';
import { ROADMAP_LANDING_PARAM } from '@/shared/constants';
import { Button } from '@/shared/ui';

/**
 * THE ROADMAP AT A COLUMN'S WIDTH: the chat gutter's Roadmap widget is the roadmap face the tab draws
 * (`RoadmapTreeFace`), in its `column` fit, with "Open the roadmap" pinned at its foot. A gutter cell cannot hold a
 * legible tree and a panel side by side, so the whole column scrolls as one: the picker, the tree at its natural
 * size in its own sideways pane, then the panel. The card's full-screen switch is the at-a-glance view, where the
 * widget draws the tab itself (`RoadmapWidgetFullscreenBody`).
 *
 * ONE ROADMAP ON SCREEN EVERYWHERE. The face's picker writes the selection the tab's picker writes, so a pick here
 * is a pick on the tab, on every device. A feature dialog opens over the chat; its Open its card and Answer on its
 * card, and the foot's "Open the roadmap", are landings (`?runner=<plan>`, `?roadmap=<name>`), because the gutter has
 * no hold on which tab the workspace shows (`openCard` is `null`, so the face reaches the landing through
 * `useRevealCard`). `data-roadmap-widget` is the face's handle in this fit, and `data-roadmap-widget-open` the foot
 * press's.
 *
 * The roadmap is the account's and not the chat's, so the chat's id the gutter hands every body is not read. The
 * gutter draws the body `flush`: the face scrolls its own column and carries its own celebrations box.
 *
 * Used by `src/modules/chat-gutters` (`ChatGutterLayout`), through the roadmap barrel, as the Roadmap widget's body.
 */
export function RoadmapWidgetBody() {
  const { t } = useTranslation();
  const { selected } = useRoadmap();
  const [, setSearchParams] = useSearchParams();
  const openRoadmap = () => { if (selected !== null) setSearchParams({ [ROADMAP_LANDING_PARAM]: selected.name }, { replace: true }); };

  return (
    <RoadmapTreeFace
      fit="column"
      openCard={null}
      foot={(
        // The way to the whole roadmap, always in view: the foot stays put while the column scrolls.
        <div className="shrink-0 border-t border-border">
          <div className="mx-auto max-w-2xl px-1.5 py-1">
            <Button variant="link" size="sm" data-roadmap-widget-open className="h-8 gap-1.5 px-1.5 text-accent-ink" onClick={openRoadmap}>
              {t('roadmap.widget.open')}
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    />
  );
}
