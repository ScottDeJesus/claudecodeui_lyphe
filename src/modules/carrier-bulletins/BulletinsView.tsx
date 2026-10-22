import { useRef, useState } from 'react';

import { CarrierPages } from '@/modules/carrier-bulletins/CarrierPages';
import { useBulletinPages } from '@/modules/carrier-bulletins/hooks/useBulletinPages';
import { useOverview } from '@/modules/carrier-bulletins/hooks/useOverview';
import { usePageImage } from '@/modules/carrier-bulletins/hooks/usePageImage';
import { usePageReading } from '@/modules/carrier-bulletins/hooks/usePageReading';
import { OverviewScreen } from '@/modules/carrier-bulletins/OverviewScreen';
import { PageScreen } from '@/modules/carrier-bulletins/PageScreen';
import type { AffectedAreasTrouble } from '@/shared/types';

/** A screen arriving: Verve's page entrance, as the Cerberus tab's own views enter. It plays each time one opens. */
const SCREEN_ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_both]';

/**
 * One read of the lane, as `onRefresh` and `onBack` press it: a read that failed is read again as Try again (its banner
 * leaves and the screen waits for the new answer, so a second failure mounts the banner afresh and it is heard again);
 * any other is read again quietly, the screen standing as it is until the new answer lands.
 */
function readAgain(read: { trouble: AffectedAreasTrouble | null; retry: () => void; reload: () => void }) {
  if (read.trouble === null) read.reload();
  else read.retry();
}

/**
 * THE BULLETINS VIEW: what Claude read of each carrier's SERVPRO program bulletin, and what the house settled it into. The
 * operator opens it to learn, carrier by carrier, whether the current file is read and settled, what it requires, what the
 * house set aside, and what waits on him. Three screens, one at a time, each opened from the one before:
 *   1. `OverviewScreen`: every carrier's current file, what needs him first (a page waiting, a reading stopped).
 *   2. `CarrierPages`: a carrier's pages under the parts its bulletin prints, each with its state and what was found.
 *   3. `PageScreen`: a page's image beside what Claude read on it, and where that answer came from.
 *
 * READ-ONLY, by the operator's answer of 2026-10-21: "Read-only. The view shows what Claude read and what the house
 * settled. You change a rule only by answering the printed question list, or on the Approval Rules page." No press here
 * writes anything: they move between the screens, enlarge a page, and read again.
 *
 * IT READS ON OPEN AND ON A PRESS, never on a timer and never while the tab shows another view. The Cerberus tab keeps it
 * mounted (hidden) after its first show, as it keeps Tours, so the carrier, the page and the scroll a person left survive a
 * visit to Fleet; hidden, it reads nothing.
 *
 * The root is the view's data hub: its four reads and its presses are wired here, and the screens draw what they are
 * handed. Words are `cerberus.bulletins.*`; endpoints are `api.carrierBulletins`; wire shapes `@/shared/carrier-bulletins-types`.
 *
 * Used by the cerberus module's `CerberusPanel`, through this module's barrel and its `KeptView`, as the fifth view of its strip.
 */
export function BulletinsView() {
  // The view's top: what the presses bring into view when a carrier or a page opens, since each screen remounts under the
  // panel's one scroller, which keeps the offset the last screen left.
  const topRef = useRef<HTMLDivElement>(null);
  // The open carrier, by its current file's bulletin; null shows the overview. Held at the root of a view the tab keeps
  // mounted, so the carrier a person left is the one they come back to.
  const [bulletinId, setBulletinId] = useState<string | null>(null);
  // The open page of that bulletin; null shows the carrier's pages. Held beside the carrier, never in a screen, so Back
  // from a page lands on the same carrier's list.
  const [page, setPage] = useState<number | null>(null);
  // Whether the open page's image is enlarged in the house Lightbox: the Lightbox opens over the page screen and closes
  // back to it, and every page a person opens starts with it shut.
  const [enlarged, setEnlarged] = useState(false);

  // ── The reads: on open and on a press, never on a timer. Nothing here reads of its own accord (no answer arrives
  // from outside, as a Tours press's or a walk's does), so a view the tab has hidden has nothing to hold back. ──
  const overview = useOverview();
  const pages = useBulletinPages(bulletinId);
  const reading = usePageReading(bulletinId, page);
  // The page's PNG waits on the reading, which names the exact file the page is of.
  const image = usePageImage(reading.value?.file_sha256 ?? null, page);

  // ── The presses. None writes: they move between the screens, enlarge a page, and read again. ──
  // Brings the view's top into view when the panel was scrolled past it, and leaves a panel already showing it alone.
  const showTop = () => {
    const top = topRef.current;
    if (top !== null && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' });
  };
  const onOpenCarrier = (openedBulletinId: string) => {
    setBulletinId(openedBulletinId);
    setPage(null);
    setEnlarged(false);
    showTop();
  };
  const onOpenPage = (openedPage: number) => {
    setPage(openedPage);
    setEnlarged(false);
    showTop();
  };
  // One screen back, reading again what it returns to, quietly: a carrier's pages and its overview row, or the overview.
  const onBack = () => {
    setEnlarged(false);
    if (page !== null) {
      setPage(null);
      pages.reload();
    } else {
      setBulletinId(null);
    }
    overview.reload();
  };
  // Reads again what the shown screen draws, keeping the screen as it is until the new answer lands. Also every banner's Try again.
  const onRefresh = () => {
    if (bulletinId === null) {
      readAgain(overview);
    } else if (page === null) {
      readAgain(pages);
      readAgain(overview);
    } else {
      readAgain(reading);
      readAgain(pages);
    }
  };
  const onEnlarge = () => setEnlarged(true);
  // The Lightbox's close, from its Escape, its ✕ and its backdrop.
  const onShrink = () => setEnlarged(false);

  // The carrier as the overview listed it: its pages and its page draw their header from it at once, while their reads are out.
  const row = overview.value?.find((entry) => entry.bulletin_id === bulletinId) ?? null;

  let screen;
  if (bulletinId === null) {
    // No carrier open: the overview, with what needs the operator first. Its read's loading, its fault and an empty answer
    // are the screen's own states.
    screen = <OverviewScreen rows={overview.value} trouble={overview.trouble} onOpenCarrier={onOpenCarrier} onRefresh={onRefresh} />;
  } else if (page === null) {
    // A carrier open, no page: its pages under their parts. The header stands at once from the overview's row; the pages
    // wait under their own surface, and the lane's fault is said under the header.
    screen = <CarrierPages row={row} pages={pages.value} trouble={pages.trouble} onBack={onBack} onOpenPage={onOpenPage} onRefresh={onRefresh} />;
  } else {
    // A page open: its image beside its reading. The pages list stays read under it, for the page's state and part while
    // the reading is out, and for Previous and Next.
    screen = (
      <PageScreen
        row={row}
        page={page}
        pages={pages.value}
        reading={reading.value}
        trouble={reading.trouble}
        image={image}
        enlarged={enlarged}
        onBack={onBack}
        onOpenPage={onOpenPage}
        onRefresh={onRefresh}
        onEnlarge={onEnlarge}
        onShrink={onShrink}
      />
    );
  }

  return (
    <div ref={topRef} className="flex min-w-0 max-w-[1180px] flex-col px-[clamp(16px,4cqi,32px)] pb-7 pt-5">
      {/* Keyed by the screen, so each screen a person opens plays its entrance afresh. */}
      <div key={bulletinId === null ? 'overview' : `${bulletinId}:${page ?? 'pages'}`} className={SCREEN_ENTER}>
        {screen}
      </div>
    </div>
  );
}
