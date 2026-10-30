import { ArrowUpRight, Bomb, Bookmark, Gavel, Lightbulb, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useStation, useStationPref } from '@/modules/station/context/StationContext';
import { useMemoryLines } from '@/modules/station/hooks/useMemoryLines';
import { MemoryLine } from '@/modules/station/MemoryLine';
import { docSpacePageUrl } from '@/modules/widgets';
import type { CompanionMemoryLines } from '@/shared/companion-types';
import type { StationRegionProps, StationTier } from '@/shared/types';
import { Banner, Button, buttonVariants, CardFoldBody, Collapsible, CollapsibleTrigger, EmptyState, FoldChevron, ScrollArea, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * EVERY KIND OF MEMORY AS THE CORNER NAMES IT, the one map of them: its glyph and its word. Rules, gotchas and landmines
 * are the docstore's invariant kinds; a manual row is a name he gave something ("Hoge is said Hoagie"), so its word is
 * "name". A kind the map does not hold is said as the docstore says it, beside the bookmark. A Map, so a kind spelled like
 * `constructor` is a word and not a prototype key. No kind is toned: a memory is not a state that asks him to act, so
 * every kind is the muted ink, its glyph and its word together (MAN-578).
 */
const MEMORY_KINDS: ReadonlyMap<string, { icon: LucideIcon; wordKey: string; word: string }> = new Map([
  ['rule', { icon: Gavel, wordKey: 'station.memory.kind.rule', word: 'rule' }],
  ['gotcha', { icon: Lightbulb, wordKey: 'station.memory.kind.gotcha', word: 'gotcha' }],
  ['landmine', { icon: Bomb, wordKey: 'station.memory.kind.landmine', word: 'landmine' }],
  ['manual', { icon: Tag, wordKey: 'station.memory.kind.manual', word: 'name' }],
]);

/** A memory's kind, drawn: its glyph beside its word. */
function KindMark({ kind }: { kind: string }) {
  const { t } = useTranslation();
  const known = MEMORY_KINDS.get(kind);
  const Glyph = known?.icon ?? Bookmark;
  return (
    <span data-station-memory-kind={kind} className="flex min-w-0 items-center gap-1">
      <Glyph aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{known === undefined ? kind : t(known.wordKey, { defaultValue: known.word })}</span>
    </span>
  );
}

/** A press of the corner below 768 px: a 44 px catch under a finger (the shell's touch law). */
const TOUCH_PRESS = 'max-md:min-h-11';

/**
 * The corner's own line, in the left rail's fold look (`RailFold`): the whole line is the press, a quiet ground under the
 * pointer, its keyboard ring drawn inside it (a fold's body clips what passes its edges), the house's sign before its words.
 */
const HEAD_PRESS = 'relative flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-muted-foreground transition-colors duration-quick hover:bg-muted/60 hover:text-foreground focus-visible:-outline-offset-2';

/** What the corner can say of her memory: the first read still out, unreadable, nothing kept, or her lines. */
type CornerState = 'reading' | 'unreadable' | 'empty' | 'kept';

type MemoryCornerViewProps = {
  /**
   * The arrangement. In the rail's columns (wide, laptop) the corner stands at the rail's foot: its line stays at the foot
   * and the corner opens upward over it, so the press stays under the pointer, and its lines scroll in a short list. In the
   * narrow stack it opens downward, as a page that scrolls does, and its lines take their own height.
   */
  tier: StationTier;
  /**
   * Her memory as the page last read it, newest said first: `count: null` with the door's own `reason` when her bank could
   * not be read. Null while the first read is out.
   */
  reading: CompanionMemoryLines | null;
  /**
   * Why the page's own read failed, in its words; null when it did not. It stands over `reading`: a read that failed after
   * one that landed says her memory can't be read now, never the older list as if it were current.
   */
  failure: string | null;
  /** Try again: her memory read once more. */
  onReread: () => void;
  /** The corner stands open. His press alone opens it: nothing she keeps or forgets, no frame and no reload does. */
  open: boolean;
  /** The corner's line pressed: `true` opens it, `false` folds it to its one line. */
  onOpenChange: (open: boolean) => void;
  /** The token of the line whose words stand open, or null: one line at a time. */
  openLine: string | null;
  /** A line pressed: its token opens its words and folds any other's, null folds them. */
  onOpenLine: (token: string | null) => void;
  /** Her memory's full page in DocSpace (`page-kaylee-memory`), opened in a new tab; null until a reading names it. */
  pageUrl: string | null;
  /** The list's scroller, for the station's scroll memory on the page. Absent on a fixture, which remembers nothing. */
  scrollRef?: (node: HTMLElement | null) => void;
};

/**
 * "WHAT I'M KEEPING", THE CORNER AT THE FOOT OF THE STATION'S LEFT RAIL: her memory as short titled lines, closed until he
 * opens it.
 *
 * - CLOSED, one quiet line in the muted ink: "What I'm keeping", the count ("· 7"; "· —" when her memory can't be read;
 *   nothing while the first read is out) and the chevron. It is a disclosure `button` with `aria-expanded`. It NEVER OPENS
 *   BY ITSELF: a memory she keeps or forgets moves the count and nothing else, and the count is no live region.
 * - OPEN (kit `Collapsible`, its folded body inert so its presses leave the tab order): her lines, each its kind's glyph
 *   and word, its title and the moment he said it, a press opening his first words under it (`MemoryLine`), one line at a
 *   time; then "Open the full page", her memory's DocSpace page in a new tab, the memory whole.
 * - "Reading her memory…" while the first read is out; "Nothing kept yet" (kit `EmptyState`) when she keeps nothing; and
 *   when her memory can't be read, a warn `Banner`: "Her memory can't be read just now", the door's own sentence and Try
 *   again, the count "—" — the word and the sentence, never colour alone (MAN-578).
 *
 * THE TOUCH LAW: below 768 px the corner's line, each memory and the full page's link are 44 px catches, and nothing is said
 * only on hover. It reads and never writes her memory.
 *
 * `data-station-corner` reads the state. A pure view: `MemoryCorner` below binds it, and `.verify/kaylee-station-shots.mjs`
 * draws it on the fixtures' pictures (`fake/corner.ts`).
 */
export function MemoryCornerView({
  tier, reading, failure, onReread, open, onOpenChange, openLine, onOpenLine, pageUrl, scrollRef,
}: MemoryCornerViewProps) {
  const { t } = useTranslation();
  const labelId = useId();
  const rail = tier !== 'narrow';

  const unreadable = failure !== null || (reading !== null && reading.count === null);
  const state: CornerState = unreadable ? 'unreadable' : reading === null ? 'reading' : reading.lines.length === 0 ? 'empty' : 'kept';
  // The page's own failure first, else the door's sentence: the newest word on why her memory can't be read.
  const sentence = failure ?? reading?.reason ?? null;
  const count = reading?.count ?? 0;

  // The count stays in the muted ink, open or closed: "· 7", "· —" when it can't be read, nothing while the first read is
  // out. The line's name says it in words ("What I'm keeping, 7 memories"), so the dot and the dash are never read out.
  const title = t('station.memory.title', { defaultValue: "What I'm keeping" });
  let countMark: ReactNode = null;
  let toggleName = title;
  if (state === 'unreadable') {
    countMark = <span data-station-corner-count="unknown" className="text-muted-foreground">· —</span>;
    toggleName = t('station.memory.toggleUnknown', { defaultValue: "What I'm keeping, how many can't be read" });
  } else if (state !== 'reading') {
    countMark = <span data-station-corner-count={count} className="tabular-nums text-muted-foreground">· {count}</span>;
    toggleName = t('station.memory.toggle', {
      count, defaultValue_one: "What I'm keeping, {{count}} memory", defaultValue_other: "What I'm keeping, {{count}} memories",
    });
  }

  let body: ReactNode;
  if (state === 'reading') {
    body = (
      <div className="flex justify-center py-4">
        <Spinner size={20} label={t('station.memory.reading', { defaultValue: 'Reading her memory…' })} />
      </div>
    );
  } else if (state === 'unreadable') {
    body = (
      <Banner tone="warn">
        <p className="text-sm font-medium">{t('station.memory.unreadable', { defaultValue: "Her memory can't be read just now" })}</p>
        {sentence !== null && <p data-station-corner-reason="" className="mt-0.5 break-words text-xs">{sentence}</p>}
        <Button
          variant="tonal"
          size="sm"
          data-station-corner-retry=""
          className="mt-2 h-8 px-2.5 text-xs max-md:h-11"
          onClick={onReread}
        >
          {t('station.memory.retry', { defaultValue: 'Try again' })}
        </Button>
      </Banner>
    );
  } else if (state === 'empty') {
    body = (
      <EmptyState
        icon={Bookmark}
        title={t('station.memory.empty.title', { defaultValue: 'Nothing kept yet' })}
        message={t('station.memory.empty.message', { defaultValue: 'What she keeps of what you say shows here.' })}
      />
    );
  } else {
    body = (
      <ScrollArea ref={scrollRef} className={cn('flex min-h-0 flex-col', rail && 'max-h-64')}>
        <ul aria-labelledby={labelId} className="flex min-w-0 flex-col gap-0.5">
          {(reading?.lines ?? []).map((line) => (
            <MemoryLine
              key={line.token}
              line={line}
              kind={<KindMark kind={line.kind} />}
              open={openLine === line.token}
              onOpenChange={(next) => onOpenLine(next ? line.token : null)}
            />
          ))}
        </ul>
      </ScrollArea>
    );
  }

  // The full page holds her memory whole: drawn wherever there is memory to read there, once a reading has named it.
  const pageHref = state === 'kept' || state === 'unreadable' ? pageUrl : null;

  return (
    <section data-station-corner={state} aria-labelledby={labelId} className="flex min-w-0 flex-col p-2">
      <Collapsible open={open} onOpenChange={onOpenChange} className={cn('flex min-w-0', rail ? 'flex-col-reverse' : 'flex-col')}>
        <CollapsibleTrigger data-station-corner-toggle="" aria-label={toggleName} className={cn(HEAD_PRESS, TOUCH_PRESS)}>
          <FoldChevron collapsed={!open} className="text-sm" />
          {/* One run of words, as the rail's own folds set theirs ("Asleep · 11"): the count's dot one space from the word. */}
          <span className="min-w-0 truncate text-sm">
            <span id={labelId} className="font-medium">{title}</span>
            {countMark !== null && ' '}
            {countMark}
          </span>
        </CollapsibleTrigger>
        <CardFoldBody className="min-w-0">
          <div className={cn('flex min-w-0 flex-col gap-1', rail ? 'pb-1' : 'pt-1')}>
            {body}
            {pageHref !== null && (
              // The accent's text ink, not the ghost button's own accent: that one is 2.81:1 on the light canvas at this size, the ink 4.7:1.
              <a
                href={pageHref}
                target="_blank"
                rel="noopener noreferrer"
                data-station-corner-page=""
                aria-label={t('station.memory.pageLabel', { defaultValue: 'Open the full page: her memory in DocSpace, in a new tab' })}
                className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'self-start px-2.5 text-accent-ink', TOUCH_PRESS)}
              >
                {t('station.memory.page', { defaultValue: 'Open the full page' })}
                <ArrowUpRight aria-hidden="true" />
              </a>
            )}
          </div>
        </CardFoldBody>
      </Collapsible>
    </section>
  );
}

/**
 * The corner on the page, the `corner` slot's region (`stationRegions.ts`): it reads her lines and the corner's open state and
 * hands them, with the line whose words stand open, to `MemoryCornerView`.
 *
 * - HER LINES are `useMemoryLines()`'s: read at mount, on every `companion_memory` frame and on reconnect. A new memory moves
 *   the count and the list and nothing else.
 * - THE CORNER'S OPEN STATE is the station pref `cornerOpen`, false until he opens it and written by his press alone
 *   (`onOpenChange`), so no frame, no new memory and no reload opens it.
 * - THE FULL PAGE is her memory's DocSpace page, linked through `docSpacePageUrl`, the shell's one builder of that link
 *   (Settings' "Open her memory" reads it too).
 *
 * It reads and never writes her memory.
 */
export function MemoryCorner({ tier }: StationRegionProps) {
  const { lines, failure, reread } = useMemoryLines();
  const [open, setOpen] = useStationPref('cornerOpen', false);
  const { scrollMemory } = useStation();
  // The page is named by the reading itself (the server owns the id), so there is no link before a reading lands.
  const pageUrl = lines === null || lines.pageId === '' ? null : docSpacePageUrl(lines.pageId, null);
  // Which line's words stand open: the token of the one line he pressed open, or null. The wrapper's own and never stored:
  // a reload, or a tier change that moves the corner, folds them.
  const [openLine, setOpenLine] = useState<string | null>(null);

  return (
    <MemoryCornerView
      tier={tier}
      reading={lines}
      failure={failure}
      onReread={reread}
      open={open}
      onOpenChange={setOpen}
      openLine={openLine}
      onOpenLine={setOpenLine}
      pageUrl={pageUrl}
      scrollRef={scrollMemory('corner')}
    />
  );
}
