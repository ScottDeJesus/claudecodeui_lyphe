import type { TFunction } from 'i18next';
import { ChevronLeft } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { BulletinsTrouble } from '@/modules/carrier-bulletins/BulletinsTrouble';
import { CommandLine } from '@/modules/carrier-bulletins/CommandLine';
import { PageRow } from '@/modules/carrier-bulletins/PageRow';
import { RefreshButton } from '@/modules/carrier-bulletins/RefreshButton';
import { StateBadge } from '@/modules/carrier-bulletins/StateBadge';
import { carrierStanding, partGroups, STANDING_LOOK } from '@/modules/carrier-bulletins/utils/bulletinModel';
import { fileWords, pageSplitWords, pullCommand, standingWords } from '@/modules/carrier-bulletins/utils/bulletinWords';
import type { BulletinPage, OverviewRow } from '@/shared/carrier-bulletins-types';
import type { AffectedAreasTrouble } from '@/shared/types';
import { Banner, Button, Card } from '@/shared/ui';

type CarrierPagesProps = {
  /** The carrier as the overview listed it: the header is drawn from it at once, while its pages are read. */
  row: OverviewRow | null;
  /** The bulletin's pages in page order; null while the read is out or when it failed. */
  pages: BulletinPage[] | null;
  trouble: AffectedAreasTrouble | null;
  onBack: () => void;
  onOpenPage: (page: number) => void;
  onRefresh: () => void;
};

/** Whether every page of a part stands the same, so its heading says the state once and its rows carry none (one page excepted). */
function sameState(pages: BulletinPage[]): boolean {
  return pages.length > 1 && pages.every((page) => page.state === pages[0].state);
}

/**
 * A part's pages in figures: "Pages 11–51 · 41 pages · all settled" when every page stands the same, else the waiting and
 * unread ones counted where there are any ("Pages 1–32 · 32 pages · 1 waiting").
 */
function partRange(pages: BulletinPage[], t: TFunction): string {
  const first = pages[0].page;
  const last = pages[pages.length - 1].page;
  const parts = [pages.length === 1 ? t('cerberus.bulletins.carrier.onePage', { page: first }) : t('cerberus.bulletins.carrier.pageRange', { from: first, to: last, count: pages.length })];
  if (sameState(pages)) return [...parts, t(`cerberus.bulletins.carrier.all.${pages[0].state}`)].join(' · ');
  const waiting = pages.filter((page) => page.state === 'waiting').length;
  const unread = pages.filter((page) => page.state === 'unread').length;
  if (waiting > 0) parts.push(t('cerberus.bulletins.split.waiting', { count: waiting }));
  if (unread > 0) parts.push(t('cerberus.bulletins.split.unread', { count: unread }));
  return parts.join(' · ');
}

/** Verve's waiting surface in the shape of a part: its heading and a card of page rows, while the pages are read. */
function ReadingPages() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <p role="status" className="sr-only">{t('cerberus.bulletins.carrier.reading')}</p>
      <div aria-hidden="true" className="vv-skeleton h-5 w-2/5" />
      <Card aria-hidden="true" className="flex flex-col gap-3 px-4 py-3.5">
        {[0, 1, 2, 3, 4, 5].map((row) => <div key={row} className="vv-skeleton h-4 w-full" />)}
      </Card>
    </div>
  );
}

/**
 * A CARRIER: its current file, then its pages under the parts the bulletin prints.
 *
 * Read top to bottom: All carriers (the way back), the carrier's name, its file (bulletin number, the day it was stored),
 * its standing with how its pages split, and Refresh at the right; then what needs the operator, when anything does — the
 * waiting pages, with why the carrier cannot settle, the first one to open and the manual pull that reads them again; or a
 * reading that stopped before the file settled, with how many pages are not read and the pull that reads them now; or, for
 * a file Claude has not read at all, when it will be read and the pull that reads it now; then each part — the main
 * program, then each exhibit, headed by the bulletin's own words with its page range — as a card of `PageRow`s. A part
 * whose pages all stand the same says so once beside its range ("all settled"), and its rows carry no state of their own.
 *
 * Every part heading is the bulletin's words, drawn as a text node (R-CERB-25). A file with no outline (one page, or one
 * Claude read without its parts) is one card headed "Pages".
 *
 * States: the header at once from the overview's row (a skeleton when the view has none), the pages read (a part-shaped
 * waiting surface), the lane's fault (the header and the banner alone, as the overview and the page draw theirs), a file
 * never read, a reading stopped, waiting pages, and the parts.
 *
 * Used by the carrier-bulletins module's view root.
 */
export function CarrierPages({ row, pages, trouble, onBack, onOpenPage, onRefresh }: CarrierPagesProps) {
  const { t } = useTranslation();
  const baseId = useId();
  // A failed read draws its banner alone, as the overview and the page do: pages held from an earlier read could still show
  // a calm "Settled" under it, and a monitor that cannot see must not look calm.
  const shown = trouble === null ? pages : null;
  const waiting = shown?.filter((page) => page.state === 'waiting') ?? [];
  // A reading that stopped before the file settled is the overview's Needs you; it is said here with what follows from it.
  const stopped = trouble === null && row !== null && carrierStanding(row) === 'stopped';
  const neverRead = !stopped && shown !== null && shown.length > 0 && shown.every((page) => page.state === 'unread');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col items-start gap-1">
          <Button variant="ghost" size="sm" className="-ml-3 max-md:h-11" onClick={onBack}>
            <ChevronLeft aria-hidden="true" />
            {t('cerberus.bulletins.carrier.back')}
          </Button>
          {row === null ? (
            <div aria-hidden="true" className="flex w-full flex-col gap-2 pt-1">
              <div className="vv-skeleton h-6 w-2/5" />
              <div className="vv-skeleton h-3.5 w-3/5" />
            </div>
          ) : (
            <>
              <h2 className="text-[20px] font-bold leading-tight tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">{row.carrier}</h2>
              <p className="text-[13.5px] text-muted-foreground">{fileWords(row, t)}</p>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1">
                <StateBadge tone={STANDING_LOOK[carrierStanding(row)].tone} icon={STANDING_LOOK[carrierStanding(row)].icon} words={standingWords(row, t)} />
                <span className="text-[12.5px] text-muted-foreground">{pageSplitWords(row, t)}</span>
              </div>
            </>
          )}
        </div>
        <RefreshButton onRefresh={onRefresh} />
      </header>

      {trouble !== null && <BulletinsTrouble trouble={trouble} subject="pages" onRetry={onRefresh} />}
      {trouble === null && pages === null && <ReadingPages />}

      {/* What needs the operator stands above the parts: a waiting page holds the whole carrier's settlement. */}
      {waiting.length > 0 && row !== null && (
        <Banner
          tone="warn"
          action={(
            <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={() => onOpenPage(waiting[0].page)}>
              {t('cerberus.bulletins.carrier.openPage', { page: waiting[0].page })}
            </Button>
          )}
        >
          <p className="text-sm font-medium">
            {t('cerberus.bulletins.carrier.waiting', { count: waiting.length, pages: waiting.map((page) => page.page).join(', ') })}
          </p>
          <p className="mt-0.5 text-xs">{t('cerberus.bulletins.carrier.waitingDetail', { count: waiting.length, carrier: row.carrier })}</p>
          <div className="mt-1.5"><CommandLine command={pullCommand(row.carrier)} /></div>
        </Banner>
      )}
      {stopped && row !== null && (
        <Banner tone="warn">
          <p className="text-sm font-medium">{t('cerberus.bulletins.carrier.stopped')}</p>
          <p className="mt-0.5 text-xs">
            {row.unread > 0
              ? t('cerberus.bulletins.carrier.stoppedDetail', { count: row.unread, carrier: row.carrier })
              : t('cerberus.bulletins.carrier.stoppedSettle', { carrier: row.carrier })}
          </p>
          <div className="mt-1.5"><CommandLine command={pullCommand(row.carrier)} /></div>
        </Banner>
      )}
      {neverRead && row !== null && (
        <Banner tone="neutral">
          <p className="text-sm font-medium">{t('cerberus.bulletins.carrier.neverRead')}</p>
          <p className="mt-0.5 text-xs">{t('cerberus.bulletins.carrier.neverReadDetail', { carrier: row.carrier })}</p>
          <div className="mt-1.5"><CommandLine command={pullCommand(row.carrier)} /></div>
        </Banner>
      )}

      {shown !== null && partGroups(shown).map((part, index) => (
        <section key={part.pages[0].page} aria-labelledby={`${baseId}-${index}`} className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
            <h3 id={`${baseId}-${index}`} className="min-w-0 text-[15px] font-semibold text-foreground [overflow-wrap:anywhere]">
              {part.heading === '' ? t('cerberus.bulletins.carrier.noPart') : part.heading}
            </h3>
            <p className="text-[12.5px] text-muted-foreground">{partRange(part.pages, t)}</p>
          </div>
          <Card className="overflow-hidden">
            <ul aria-labelledby={`${baseId}-${index}`} className="m-0 list-none divide-y divide-border p-0">
              {part.pages.map((page) => <PageRow key={page.page} page={page} showState={!sameState(part.pages)} onOpen={onOpenPage} />)}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}
