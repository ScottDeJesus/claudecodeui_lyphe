import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BulletinsTrouble } from '@/modules/carrier-bulletins/BulletinsTrouble';
import { PageImage } from '@/modules/carrier-bulletins/PageImage';
import { ReadingColumn } from '@/modules/carrier-bulletins/ReadingColumn';
import { RefreshButton } from '@/modules/carrier-bulletins/RefreshButton';
import { StateBadge } from '@/modules/carrier-bulletins/StateBadge';
import { neighbours, PAGE_STATE_LOOK, pageStateOf, partOfPage } from '@/modules/carrier-bulletins/utils/bulletinModel';
import { stampWords } from '@/modules/carrier-bulletins/utils/bulletinWords';
import type { BulletinPage, OverviewRow, PageReading } from '@/shared/carrier-bulletins-types';
import type { AffectedAreasTrouble } from '@/shared/types';
import { Button } from '@/shared/ui';

type PageScreenProps = {
  /** The carrier as the overview listed it: the way back, and how many pages its file has. */
  row: OverviewRow | null;
  page: number;
  /** The carrier's pages: this page's state and part while its reading is out, and Previous and Next. Null until read. */
  pages: BulletinPage[] | null;
  /** What Claude read on the page; null while the read is out or when it failed. */
  reading: PageReading | null;
  trouble: AffectedAreasTrouble | null;
  /** The page's PNG as an object URL; null while it loads, when it failed, and until the reading names the file. */
  image: string | null;
  /** Whether the image is open in the house Lightbox. */
  enlarged: boolean;
  onBack: () => void;
  onOpenPage: (page: number) => void;
  onRefresh: () => void;
  onEnlarge: () => void;
  onShrink: () => void;
};

/** Two columns once the panel is wide enough to hold the page beside its reading: the page five parts, the reading six. */
const COLUMNS = 'grid items-start gap-5 [@container(min-width:720px)]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]';

/**
 * A PAGE: its image beside what Claude read on it.
 *
 * Read top to bottom: the way back (the carrier's name), "Page 13 of 51", the part it sits in — the bulletin's own heading,
 * and on the page where a part begins the part that ends there — its state with where its answer came from ("Read 2h ago
 * on this file · claude-sonnet-5-5 · 1 call · 37.6K tokens", or "Carried from the Jun 3 file, read Oct 22" for a page
 * whose content did not change), and at the right the pages either side of it and Refresh. Then the page as stored
 * (`PageImage`) beside the reading (`ReadingColumn`): wide, the image keeps its place while a long reading scrolls past it;
 * narrow, the image stands above the reading. Enlarge opens the image in the house `Lightbox`.
 *
 * Every word from the bulletin — the part heading, a quote, a doubt, a rule's words — is a text node (R-CERB-25).
 *
 * States: the header at once from the overview's row and the pages list, the page read, the lane's fault or a page that is
 * not there (the header and the banner alone: no image beside a reading that did not answer), waiting, not read, read with
 * nothing found, and the reading.
 *
 * Used by the carrier-bulletins module's view root.
 */
export function PageScreen({
  row, page, pages, reading, trouble, image, enlarged, onBack, onOpenPage, onRefresh, onEnlarge, onShrink,
}: PageScreenProps) {
  const { t } = useTranslation();
  const summary = pages?.find((entry) => entry.page === page) ?? null;
  const state = pageStateOf(summary, reading);
  const part = partOfPage(pages, page, reading?.part ?? summary?.part ?? '');
  const { previous, next } = neighbours(pages, page);
  const carrier = row?.carrier ?? '';
  // Where the page's answer came from; null for a page with no answer (waiting, not read) and while the reading is out.
  const stamp = reading?.reading ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col items-start gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3 max-w-full max-md:h-11"
            aria-label={carrier === '' ? t('cerberus.bulletins.carrier.back') : t('cerberus.bulletins.page.back', { carrier })}
            onClick={onBack}
          >
            <ChevronLeft aria-hidden="true" />
            <span className="truncate">{carrier === '' ? t('cerberus.bulletins.carrier.back') : carrier}</span>
          </Button>
          <h2 className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground">
            {row === null ? t('cerberus.bulletins.page.title', { page }) : t('cerberus.bulletins.page.titleOf', { page, count: row.pages })}
          </h2>
          {part.heading !== '' && (
            <p className="text-[13.5px] text-muted-foreground [overflow-wrap:anywhere]">
              <span className="font-medium text-foreground">{part.heading}</span>
              {part.closes !== null && (
                <>
                  <span className="text-ink-faint"> · {t('cerberus.bulletins.page.beginsAfter')} </span>
                  {part.closes}
                </>
              )}
            </p>
          )}
          {(state !== null || stamp !== null) && (
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1">
              {state !== null && <StateBadge tone={PAGE_STATE_LOOK[state].tone} icon={PAGE_STATE_LOOK[state].icon} words={t(`cerberus.bulletins.pageState.${state}`)} />}
              {stamp !== null && <span className="text-[12.5px] text-muted-foreground">{stampWords(stamp, t)}</span>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {previous !== null && (
            <Button variant="ghost" size="sm" className="h-8 max-md:h-11" onClick={() => onOpenPage(previous)}>
              <ChevronLeft aria-hidden="true" />
              {t('cerberus.bulletins.page.goTo', { page: previous })}
            </Button>
          )}
          {next !== null && (
            <Button variant="ghost" size="sm" className="h-8 max-md:h-11" onClick={() => onOpenPage(next)}>
              {t('cerberus.bulletins.page.goTo', { page: next })}
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
          <RefreshButton onRefresh={onRefresh} />
        </div>
      </header>

      {/* A page that did not answer draws its banner alone, never an image beside an empty column. */}
      {trouble !== null ? (
        <BulletinsTrouble trouble={trouble} subject="page" onRetry={onRefresh} />
      ) : (
        <div className={COLUMNS}>
          <PageImage image={image} page={page} carrier={carrier} stored={row?.stored_at ?? null} enlarged={enlarged} onEnlarge={onEnlarge} onShrink={onShrink} />
          <div className="min-w-0">
            <ReadingColumn value={reading} carrier={carrier} />
          </div>
        </div>
      )}
    </div>
  );
}
