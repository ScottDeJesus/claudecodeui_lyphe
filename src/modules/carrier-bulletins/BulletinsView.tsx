import { useState } from 'react';

// FILL: fake — this import leaves with carrier-bulletins-fake.ts, which the fill deletes: the four reads and the six presses below take its place.
import { FAKE_READS, unwired } from '@/modules/carrier-bulletins/carrier-bulletins-fake';
import { CarrierPages } from '@/modules/carrier-bulletins/CarrierPages';
import { OverviewScreen } from '@/modules/carrier-bulletins/OverviewScreen';
import { PageScreen } from '@/modules/carrier-bulletins/PageScreen';

/** A screen arriving: Verve's page entrance, as the Cerberus tab's own views enter. It plays each time one opens. */
const SCREEN_ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_both]';

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
 * Used by the cerberus module's `CerberusPanel`, through this module's barrel, as the fifth view of its strip.
 */
export function BulletinsView() {
  // The open carrier, by its current file's bulletin; null shows the overview. Held at the root of a view the tab keeps
  // mounted, so the carrier a person left is the one they come back to.
  const [bulletinId, setBulletinId] = useState<string | null>(null);
  // The open page of that bulletin; null shows the carrier's pages. Held beside the carrier, never in a screen, so Back
  // from a page lands on the same carrier's list.
  const [page, setPage] = useState<number | null>(null);
  // Whether the open page's image is enlarged in the house Lightbox: the Lightbox opens over the page screen and closes
  // back to it, and every page a person opens starts with it shut.
  const [enlarged, setEnlarged] = useState(false);

  // ── The reads: on open and on Refresh, never on a timer and never while the view is hidden. ──
  // FILL: useOverview — useOverview(): every carrier's current file, read when the view opens and on Refresh; { value, trouble, retry }.
  const overview = FAKE_READS.overview;
  // FILL: useBulletinPages — useBulletinPages(bulletinId): the open carrier's pages in page order, read when the carrier opens and on Refresh; nothing while bulletinId is null.
  const pages = FAKE_READS.pages(bulletinId);
  // FILL: usePageReading — usePageReading(bulletinId, page): what Claude read on the open page, read when the page opens and on Refresh; nothing while page is null.
  const reading = FAKE_READS.reading(bulletinId, page);
  // FILL: usePageImage — usePageImage(reading.value?.file_sha256 ?? null, page): the page's PNG fetched with the token as an object URL, revoked on change and unmount; null while it loads, when it failed, or with no page open.
  const image = FAKE_READS.image(reading.value?.file_sha256 ?? null, page);

  // ── The presses. None writes: they move between the screens, enlarge a page, and read again. ──
  // FILL: onOpenCarrier — opens a carrier's pages: setBulletinId(bulletinId), setPage(null), setEnlarged(false), and the view's top brought into view.
  const onOpenCarrier: (bulletinId: string) => void = unwired(setBulletinId, setPage, setEnlarged);
  // FILL: onOpenPage — opens a page of the open carrier, from its list, its waiting call-out, or Previous and Next: setPage(page), setEnlarged(false), the top in view.
  const onOpenPage: (page: number) => void = unwired(setPage, setEnlarged);
  // FILL: onBack — one screen back: from a page to its carrier's pages (setPage(null)), from a carrier to the overview (setBulletinId(null)); the Lightbox shut. Back reads again what it returns to, quietly.
  const onBack: () => void = unwired(setBulletinId, setPage, setEnlarged);
  // FILL: onRefresh — reads again what the shown screen draws (the overview; a carrier's pages and its overview row; a page's reading and its pages), keeping the screen as it is until the new answer lands. Also every banner's Try again.
  const onRefresh: () => void = unwired();
  // FILL: onEnlarge — opens the page's image in the house Lightbox: setEnlarged(true).
  const onEnlarge: () => void = unwired(setEnlarged);
  // FILL: onEnlarge (its close) — the Lightbox's Escape, its ✕ and its backdrop: setEnlarged(false).
  const onShrink: () => void = unwired(setEnlarged);

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
    <div className="flex min-w-0 max-w-[1180px] flex-col px-[clamp(16px,4cqi,32px)] pb-7 pt-5">
      {/* Keyed by the screen, so each screen a person opens plays its entrance afresh. */}
      <div key={bulletinId === null ? 'overview' : `${bulletinId}:${page ?? 'pages'}`} className={SCREEN_ENTER}>
        {screen}
      </div>
    </div>
  );
}
