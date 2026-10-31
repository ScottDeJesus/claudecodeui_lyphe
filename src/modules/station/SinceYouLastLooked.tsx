import type { TFunction } from 'i18next';
import { FoldHorizontal, Layers, PackageCheck, PlaneLanding, ShieldCheck, UnfoldHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useStation, useStationPref } from '@/modules/station/context/StationContext';
import { useStationLanded } from '@/modules/station/context/StationLandedContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { LandedEntry } from '@/modules/station/LandedEntry';
import { LandedTimeline } from '@/modules/station/LandedTimeline';
import { StripFailedLine, StripLine, StripQuietLine, StripReadingLine } from '@/modules/station/StripLines';
import { STATION_COUNT_FORM_CATCH } from '@/shared/constants';
import type { StationFocus, StationLanded, StationLandedKind, StationSession } from '@/shared/station-types';
import type { StationDensity, StationRegionProps, Tone } from '@/shared/types';
import { Badge, Button, Chip, Tooltip } from '@/shared/ui';
import { cn, formatShortDate } from '@/shared/utils';

/**
 * EVERY KIND OF LANDING AS THE STRIP DRAWS IT, the one map of them: its badge's glyph, word and tone, never colour alone (MAN-578).
 * A shipped feature, a finished epic and a recovered check came good (`positive`); a chat's landing is news with no verdict (`info`).
 */
const LANDED_KINDS: Record<StationLandedKind, { icon: LucideIcon; wordKey: string; word: string; tone: Tone }> = {
  shipped: { icon: PackageCheck, wordKey: 'station.strip.kind.shipped', word: 'Shipped', tone: 'positive' },
  epic: { icon: Layers, wordKey: 'station.strip.kind.epic', word: 'Epic complete', tone: 'positive' },
  landed: { icon: PlaneLanding, wordKey: 'station.strip.kind.landed', word: 'Landed', tone: 'info' },
  recovered: { icon: ShieldCheck, wordKey: 'station.strip.kind.recovered', word: 'Recovered', tone: 'positive' },
};

/** A landing's kind, drawn: the kit `Badge` in its compact size, its glyph beside its word. */
function KindBadge({ kind }: { kind: StationLandedKind }) {
  const { t } = useTranslation();
  const { icon: Glyph, wordKey, word, tone } = LANDED_KINDS[kind];
  return (
    <Badge as="span" tone={tone} className="vv-badge--compact shrink-0 gap-1">
      <Glyph aria-hidden="true" className="size-3" />
      {t(wordKey, { defaultValue: word })}
    </Badge>
  );
}

/**
 * When a landing (or his last look) was, on his clock: the locale's clock alone today ("14:02"), "yesterday 19:34", and the
 * page's one spelling of a day before that ("Oct 26", `formatShortDate`; the strip reads one week). Nothing for a non-time.
 */
function whenOf(at: string, t: TFunction): string {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) return '';
  const clock = moment.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  if (moment.toDateString() === today.toDateString()) return t('station.strip.when.today', { clock, defaultValue: '{{clock}}' });
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (moment.toDateString() === yesterday.toDateString()) {
    return t('station.strip.when.yesterday', { clock, defaultValue: 'yesterday {{clock}}' });
  }
  return t('station.strip.when.day', { day: formatShortDate(at), defaultValue: '{{day}}' });
}

/**
 * Whether a landing opens in place rather than on the stage: a recovered check, whose history names no check's path, and any
 * landing that names neither a plan nor a chat. Its press has nowhere else to lead, and a press must always do something.
 */
function opensInPlace(entry: StationLanded): boolean {
  return entry.kind === 'recovered' || (entry.plan === null && entry.sessionId === null);
}

/** The landings oldest first, the timeline's order: by when they landed, and by id within one moment. */
function oldestFirst(landed: StationLanded[]): StationLanded[] {
  return [...landed].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id - b.id);
}

type SinceYouLastLookedViewProps = {
  /** `compact`: always the folded line, the fold's press opening and closing the week over the body (the arrangement's). */
  density: StationDensity;
  /** The week's landings as the read answers them (newest first, at most 60); `null` while the first read is out. */
  landed: StationLanded[] | null;
  /** His last look (ISO): the line between what he has seen and what is new. `null` when none is on record: then all is new. */
  seenAt: string | null;
  /** The strip folded to one line: the count, the newest landing, and the press that opens it again. At compact, the week shut. */
  collapsed: boolean;
  /** The fold pressed: `true` folds the strip to its newest landing, `false` opens the whole week. */
  onCollapse: (collapsed: boolean) => void;
  /** The "<n> new" press: every landing marked seen, his last look written now. */
  onSeen: () => void;
  /** A press on a landing the stage can hold (a shipped feature, an epic, a chat's landing): it goes on the stage. */
  onPress: (entry: StationLanded) => void;
  /** Why the read failed, in its own words; `null` when it did not. A failure stands in the line's place, with Try again. */
  failure: string | null;
  /** Try again: the read made once more. */
  onReread: () => void;
  /** The timeline's scroller, for the station's scroll memory on the page. Absent on a fixture, which remembers nothing. */
  scrollRef?: (node: HTMLElement | null) => void;
  /** The line as its count alone, the phone on its side (its top row's end): "<n> new" or "Nothing new", and the fold. */
  countOnly?: boolean;
};

/**
 * "SINCE YOU LAST LOOKED", THE STRIP ACROSS THE STATION'S BAR: what landed this week, and where he last looked.
 *
 * - THE TIMELINE (open, `LandedTimeline`): the week's landings oldest to newest, sideways under a finger, landed on the
 *   newest. The rule "You last looked" stands between the last landing he saw and the first he has not, so "since you
 *   last looked" is a place on the line and not only a colour; every landing after it wears the warm edge (`LandedEntry`).
 * - FOLDED: one line, the count, the newest landing as one line (its title, then its time), and the press that opens the
 *   week again: the bar's own height on a desk, the strip's 44 px line on a phone.
 * - THE COUNT, at the line's head either way: "<n> new", a press that marks them all seen; a keyboard's focus then lands
 *   on the words that replace it. With nothing new, the words "Nothing new since you last looked" stand there instead
 *   (below 768 px, "Nothing new"), and the newest landing beside them says what last landed and when.
 * - "Nothing has landed this week" for an empty week; a quiet row of placeholders while the first read is out; a failed
 *   read in the warn tone, its glyph and its words, with Try again (`StripLines`).
 * - AT COMPACT DENSITY, always the folded line: the arrangement draws the opened week over the body, and the fold's press
 *   (its words and glyph following `collapsed`) opens and closes it there.
 * - THE COUNT FORM (`countOnly`, the phone's top row on its side): the folded line's count and fold alone, never its newest
 *   landing (the week the fold opens holds it) nor the long "Nothing new since you last looked": "<n> new" in its pill, or "Nothing
 *   new" after a hairline, so it never reads as her state beside it; each a 44 px catch wherever the window's width puts it.
 *
 * One landing at a time stands open in place: a recovered check's whole line, a row under the strip's line at its whole width
 * (one line on a desk), the view's own state and never stored. No figure of cost reaches the strip: it draws each landing's
 * title as the history kept it. Every press is a 44 px catch below 768 px; every tooltip repeats a name the press carries.
 *
 * A pure view: `SinceYouLastLooked` below binds it, and `.verify/kaylee-station-shots.mjs` draws it on the fixtures'
 * pictures (`fake/strip.ts`) in the bar's `strip` slot.
 */
export function SinceYouLastLookedView({
  density, landed, seenAt, collapsed, onCollapse, onSeen, onPress, failure, onReread, scrollRef, countOnly = false,
}: SinceYouLastLookedViewProps) {
  const { t } = useTranslation();
  // The one landing standing open in place, by id, `null` for none: the view's own, never stored, so opening one folds
  // the other and a reload starts with every line folded.
  const [openId, setOpenId] = useState<number | null>(null);
  const lineId = useId();
  // Whether "<n> new" holds a keyboard's focus. Its press marks all seen and takes it off the page, and a press taken
  // away fires no blur, so this is what says the focus has to go somewhere: to the words that replace it.
  const seenHeldFocus = useRef(false);
  const nothingNew = useRef<HTMLParagraphElement | null>(null);

  const entries = landed === null ? [] : oldestFirst(landed);
  const seenMs = seenAt === null ? Number.NaN : Date.parse(seenAt);
  // Oldest first, so what is new is the timeline's tail: everything from the first landing after his last look.
  const firstFresh = entries.findIndex((entry) => Number.isNaN(seenMs) || Date.parse(entry.at) > seenMs);
  const freshCount = firstFresh === -1 ? 0 : entries.length - firstFresh;
  const newest = entries.length === 0 ? null : entries[entries.length - 1];

  // "<n> new" gone from under a keyboard's focus: the focus moves to the "Nothing new…" words, never to the page's top.
  const hasFresh = freshCount > 0;
  useLayoutEffect(() => {
    if (hasFresh || !seenHeldFocus.current) return;
    seenHeldFocus.current = false;
    nothingNew.current?.focus();
  }, [hasFresh]);

  // What is drawn: the folded line while folded, and always at compact.
  const folded = collapsed || density === 'compact';
  if (failure !== null) return <StripFailedLine failure={failure} onReread={onReread} countOnly={countOnly} />;
  if (landed === null) return <StripReadingLine folded={folded} countOnly={countOnly} />;
  if (newest === null) return <StripQuietLine />;

  const entryOf = (entry: StationLanded, at: number, { oneLine = false, tabbable = true }: { oneLine?: boolean; tabbable?: boolean } = {}) => (
    <LandedEntry
      entry={entry}
      badge={<KindBadge kind={entry.kind} />}
      when={whenOf(entry.at, t)}
      fresh={firstFresh !== -1 && at >= firstFresh}
      fold={opensInPlace(entry) ? { open: openId === entry.id, line: lineId } : null}
      oneLine={oneLine}
      tabbable={tabbable}
      onPress={() => {
        if (opensInPlace(entry)) setOpenId((held) => (held === entry.id ? null : entry.id));
        else onPress(entry);
      }}
    />
  );

  const seenLabel = t('station.strip.seenLabel', { count: freshCount, defaultValue: '{{count}} new since you last looked: mark them seen' });
  const lead = freshCount > 0 ? (
    <div
      data-strip-seen=""
      className="shrink-0"
      onFocus={() => { seenHeldFocus.current = true; }}
      onBlur={() => { seenHeldFocus.current = false; }}
    >
      <Tooltip content={seenLabel} position="bottom" showOnFocus>
        {/* In the count form its catch grows past the pill to 44 px (the phone's top row on its side is 40 px). */}
        <Chip size="sm" action ariaLabel={seenLabel} className={cn('finger:min-h-11', countOnly && STATION_COUNT_FORM_CATCH)} onClick={onSeen}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-garnish" />
          {t('station.strip.newCount', { count: freshCount, defaultValue: '{{count}} new' })}
        </Chip>
      </Tooltip>
    </div>
  ) : (
    <p ref={nothingNew} tabIndex={-1} data-strip-nothing-new="" className={cn('shrink-0 text-sm text-muted-foreground', countOnly && 'border-l border-border pl-2.5')}>
      <span className={cn('max-md:hidden', countOnly && 'hidden')}>{t('station.strip.nothingNew', { defaultValue: 'Nothing new since you last looked' })}</span>
      <span className={cn('md:hidden', countOnly && 'md:inline')}>{t('station.strip.nothingNewShort', { defaultValue: 'Nothing new' })}</span>
    </p>
  );

  const foldLabel = collapsed
    ? t('station.strip.expand', { defaultValue: 'Show the whole week' })
    : t('station.strip.collapse', { defaultValue: 'Show only the newest' });
  const fold = (
    <div className="ml-auto shrink-0">
      <Tooltip content={foldLabel} position="bottom" showOnFocus>
        <Button
          variant="ghost"
          size="icon"
          data-strip-fold={collapsed ? 'collapsed' : 'open'}
          aria-label={foldLabel}
          className={cn('size-8 text-muted-foreground hover:text-foreground finger:size-11', countOnly && 'size-11')}
          onClick={() => onCollapse(!collapsed)}
        >
          {collapsed ? <UnfoldHorizontal aria-hidden="true" /> : <FoldHorizontal aria-hidden="true" />}
        </Button>
      </Tooltip>
    </div>
  );

  // The landing standing open, if the line draws it: folded, only the newest is drawn.
  const open = entries.find((entry) => entry.id === openId && opensInPlace(entry) && (!folded || entry === newest));
  const below = open === undefined ? null : (
    <p id={lineId} data-landed-line="" className="break-words rounded-md bg-muted px-2.5 py-1.5 text-sm leading-5 text-foreground">
      {open.title}
    </p>
  );

  if (folded) {
    return (
      <StripLine state="folded" fresh={freshCount} below={countOnly ? null : below}>
        {lead}
        {!countOnly && <div className="min-w-0 max-w-md">{entryOf(newest, entries.length - 1, { oneLine: true })}</div>}
        {fold}
      </StripLine>
    );
  }

  return (
    <StripLine state="timeline" fresh={freshCount} below={below}>
      {lead}
      <LandedTimeline
        entries={entries}
        firstFresh={firstFresh}
        lastLook={seenAt === null ? null : whenOf(seenAt, t)}
        entryOf={entryOf}
        scrollRef={scrollRef}
      />
      {fold}
    </StripLine>
  );
}

/**
 * What a landing puts on the stage. A shipped feature or an epic is its card (`plan`, labelled by its title); a landing is the chat
 * it came from, labelled by the name his sessions hold for it NOW: an entry's own `chat` is the name the chat had when the history
 * kept the row ("Untitled Session" would head the stage for good: the focus is stored); the entry's name and then its title stand
 * in while his sessions are unread or hold no such chat. The kind decides first (a shipped feature whose lane also named its chat
 * shows its card), then the other thing it names, so a press always has a stage. A landing naming neither is `null` (in place).
 */
function stageOf(entry: StationLanded, sessions: StationSession[] | null): StationFocus | null {
  const card = entry.plan === null ? null : ({ kind: 'card', plan: entry.plan, label: entry.title } as const);
  const heldName = sessions?.find((session) => session.sessionId === entry.sessionId)?.name;
  const chat = entry.sessionId === null ? null : ({ kind: 'chat', sessionId: entry.sessionId, label: heldName || entry.chat || entry.title } as const);
  return entry.kind === 'landed' ? (chat ?? card) : (card ?? chat);
}

/** The week the compact arrangement holds open over its body, and his press on a fold of it (`open`: what he asks for). */
type StripWeek = { open: boolean; onOpen: (open: boolean) => void };

/**
 * The strip on the page, the bar's `strip` slot (`stationRegions.ts`): what landed and his last look (`useStationLanded`), the
 * fold he left it in, the stage and scroll memory (`useStation`) and his chats' names (`useStationSessions`), for the view.
 *
 * - THE LANDINGS AND HIS LAST LOOK are the provider's: a landing joins on the history's own write (`station_landed`), and the
 *   last look is written on his look-aways and on "<n> new" (`markSeen`). This binder starts no read and sets no timer.
 * - THE FOLD is the columns' pref `stripCollapsed`, per device, written by his press alone. Handed the compact arrangement's `week`,
 *   it is the week's: the line's fold opens it, the strip drawn open over the body (at full) shuts it; compact never writes the pref.
 * - A PRESS puts a shipped feature's or an epic's card, or a landing's chat, on the stage (`stageOf`), and shuts the `week`. It
 *   marks nothing seen: the look-aways and "<n> new" do. A recovered check never reaches here (the view opens its line in place).
 */
export function SinceYouLastLooked({ density, week, countOnly }: StationRegionProps & { week?: StripWeek; countOnly?: boolean }) {
  const { landed, seenAt, markSeen, failure, reread } = useStationLanded();
  const [collapsed, setCollapsed] = useStationPref('stripCollapsed', false);
  const { setFocus, scrollMemory } = useStation();
  const { sessions } = useStationSessions();
  // The fold: the arrangement's week when it hands one, else the columns' pref, which compact never writes.
  const fold = week !== undefined ? { collapsed: !week.open, onCollapse: (shut: boolean) => week.onOpen(!shut) }
    : density === 'compact' ? { collapsed: true, onCollapse: () => {} } : { collapsed, onCollapse: setCollapsed };

  return (
    <SinceYouLastLookedView
      density={density}
      countOnly={countOnly}
      landed={landed}
      seenAt={seenAt}
      collapsed={fold.collapsed}
      onCollapse={fold.onCollapse}
      onSeen={markSeen}
      // The stage brings itself into view on a focus change (`StationStage`, once for every region's press), so a press needs only the focus.
      onPress={(entry) => {
        const next = stageOf(entry, sessions);
        if (next !== null) { setFocus(next); week?.onOpen(false); }
      }}
      failure={failure}
      onReread={reread}
      // The timeline runs sideways and the station's scroll memory follows `scrollTop` only, so this remembers nothing of it
      // (the timeline lands on the newest by design); bound so the region is registered with the memory like every other.
      scrollRef={scrollMemory('strip')}
    />
  );
}
