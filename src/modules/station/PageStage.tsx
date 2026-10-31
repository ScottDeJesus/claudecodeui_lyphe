import { ArrowUpRight, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { docSpacePageUrl } from '@/modules/widgets';
import type { StationFocus } from '@/shared/station-types';
import { buttonVariants, Card } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** A DocSpace page on the stage. */
type PageFocus = Extract<StationFocus, { kind: 'page' }>;

/**
 * A DOCSPACE PAGE ON THE STAGE. The stage's head already names it (the page's glyph and word over its label), so the
 * body is the page as a document card: the page glyph, whether the focus is the page or one block of it, and "Open in
 * DocSpace", which opens it in a new tab, at the block when one is named. The open is a real link (a new tab is what
 * a link does, and the reader can copy it), drawn in the kit's outline button paint, and a 44 px catch under a finger
 * below 768 px (the touch law).
 *
 * Registered for the `page` kind in the station's stage views (`stageViews.ts`), which `StationStage` draws.
 */
export function PageStage({ focus }: { focus: PageFocus }) {
  const { t } = useTranslation();
  // DocSpace's origin with `/#page=<id>`, and `&block=<id>` when a block is named: the one builder of a page link.
  const href = docSpacePageUrl(focus.pageId, focus.blockId);

  return (
    <Card data-station-page={focus.pageId} className="flex min-w-0 flex-col gap-4 p-4 lg:p-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <FileText aria-hidden="true" className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {focus.blockId === null
            ? t('station.page.page', { defaultValue: 'A page in DocSpace' })
            : t('station.page.block', { defaultValue: 'One block of a page in DocSpace' })}
        </p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        data-station-page-open=""
        className={cn(buttonVariants({ variant: 'outline' }), 'self-start finger:h-11')}
      >
        {t('station.page.open', { defaultValue: 'Open in DocSpace' })}
        <ArrowUpRight aria-hidden="true" />
      </a>
    </Card>
  );
}
