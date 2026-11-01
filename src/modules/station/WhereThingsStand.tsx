import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion';
import { useRoadmap } from '@/modules/roadmap';
import { useStation, useStationPref } from '@/modules/station/context/StationContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { RoadmapRows } from '@/modules/station/RoadmapRows';
import { SessionRows } from '@/modules/station/SessionRows';
import type { CompanionActivity, CompanionPhase } from '@/shared/companion-types';
import type { Roadmap } from '@/shared/roadmap-types';
import type { StationFocus, StationSession } from '@/shared/station-types';
import type { StationDensity, StationHerMark, StationRegionProps, StationTier } from '@/shared/types';
import { ScrollArea } from '@/shared/ui';
import { cn } from '@/shared/utils';

type WhereThingsStandViewProps = {
  /** The window's tier: a column of its own on `wide` and `laptop`, a section of the one column at `narrow`. */
  tier: StationTier;
  /** `compact`: a session on one line and a feature on one line, the folds as in full; the rail fills its section and scrolls inside itself. */
  density: StationDensity;
  /** His chats in her order, each with the line she reads of it; null until the first read has landed. */
  sessions: StationSession[] | null;
  /** Why the first read of his chats failed, in the server's sentence; null while none has (a later failure keeps the rows). */
  failure: string | null;
  /** Try again: his chats read once more. */
  onReread: () => void;
  /** The roadmap he selected: undefined until the roadmap's picture has landed, null once it has and holds no roadmap. */
  roadmap: Roadmap | null | undefined;
  /** The thing on the stage: its row is lit. */
  focus: StationFocus | null;
  /** Her mark: the chat she is reading, drafting for or walking, and her words for it; null while she looks at none. */
  her: StationHerMark | null;
  /** Whether his asleep chats' fold is open, and his press on it (the station remembers it per device). */
  asleepOpen: boolean;
  onAsleepOpen: (open: boolean) => void;
  /** Whether the complete epics' fold is open, and his press on it (remembered alike). */
  completeOpen: boolean;
  onCompleteOpen: (open: boolean) => void;
  /** A row's press: its thing (a chat, an epic, a feature) for the stage. */
  onPress: (focus: StationFocus) => void;
  /** The one scroller's ref: the station's scroll memory (`sessions`) on the page. Absent on a fixture, which remembers nothing. */
  scrollRef?: (node: HTMLElement | null) => void;
};

/**
 * WHERE THINGS STAND, the station's left rail (the `sessions` slot): his sessions over the roadmap he selected, in one scroller
 * of the rail's own, in a column and in compact's section alike, under a head that names it. Every row is a press
 * that puts its thing on the stage, the thing on the stage is lit, and nothing is said only under a pointer: a line cut to one line
 * stands whole on the stage its row's press opens.
 *
 * Its sections draw every state of their own: `SessionRows` (reading, failed, no sessions, nothing running, the rows and the asleep
 * fold, her mark) and `RoadmapRows` (reading, no roadmap, nothing open, the open epics and their features, the complete fold).
 *
 * THE HEAD (full density): "Where things stand" in the title face the right rail's "What needs you" wears (a bordered header over
 * a serif heading, the same height, so the two rails' hairlines meet across the page), over the Sessions and Roadmap eyebrows; the
 * scroller is the region the heading names (`aria-labelledby`).
 *
 * AT COMPACT DENSITY (the one-column arrangement's "Where things stand") no head is drawn: the section switch names the rail, and the
 * scroller carries the name as its `aria-label`. Each chat and each feature is one line, the epics and the two folds as in full,
 * the two sections closer together; the rail's one scroller fills the section it is given.
 *
 * ONE SCROLLER, NOT TWO: the rail is one scroller, remembered under `sessions`, with the sessions over the roadmap. Beside the
 * corner the rail's column is 380–780 px tall, and two scrollers would split that between a list of chats and twenty-odd
 * features; one flow keeps both readable, at the price that the chats scroll away under the roadmap.
 *
 * A pure view: `WhereThingsStand` below binds it to the page, and `.verify/kaylee-station-shots.mjs` draws it on the fixtures'
 * pictures (`fake/sessions.ts`).
 */
export function WhereThingsStandView({
  tier, density, sessions, failure, onReread, roadmap, focus, her, asleepOpen, onAsleepOpen, completeOpen, onCompleteOpen, onPress, scrollRef,
}: WhereThingsStandViewProps) {
  const { t } = useTranslation();
  const headId = useId();
  const compact = density === 'compact';
  const name = t('station.rail.name', { defaultValue: 'Where things stand' });
  return (
    <>
      {!compact && (
        // The right rail's head, face for face (`WhatNeedsYouView`): the same box, the same breakpoint's padding and the same 26 px
        // line, so the two rails' hairlines meet across the page.
        <header className="shrink-0 border-b border-border px-3 py-3 min-[1360px]:px-4">
          <h2 id={headId} className="flex min-h-[1.625rem] min-w-0 items-center font-serif text-lg font-normal leading-tight text-foreground">{name}</h2>
        </header>
      )}
      <ScrollArea
        ref={scrollRef}
        role="region"
        aria-label={compact ? name : undefined}
        aria-labelledby={compact ? undefined : headId}
        data-station-rail=""
        className="min-h-0 flex-1"
      >
        <div className={cn('flex min-w-0 flex-col px-2 py-3', compact ? 'gap-4' : 'gap-6')}>
          <SessionRows
            tier={tier}
            density={density}
            sessions={sessions}
            failure={failure}
            onReread={onReread}
            focus={focus}
            her={her}
            asleepOpen={asleepOpen}
            onAsleepOpen={onAsleepOpen}
            onPress={onPress}
          />
          <RoadmapRows
            tier={tier}
            density={density}
            roadmap={roadmap}
            focus={focus}
            completeOpen={completeOpen}
            onCompleteOpen={onCompleteOpen}
            onPress={onPress}
          />
        </div>
      </ScrollArea>
    </>
  );
}

/** The phases in which her activity names a chat she is looking at, each with its words; in every other phase she draws no mark. */
const HER_WORDS: Partial<Record<CompanionPhase, { key: string; english: string }>> = {
  reading_session: { key: 'station.sessions.her.reading', english: '{{name}} is reading {{chat}}' },
  drafting: { key: 'station.sessions.her.drafting', english: '{{name}} is drafting for {{chat}}' },
  walking: { key: 'station.sessions.her.walking', english: '{{name}} is walking {{chat}}' },
};

/**
 * Her mark, from her activity: the chat it names, her initial (her name's first letter, as her disc draws it) and her words, the
 * presence's own verbs ("reading", "drafting for", "walking") with the chat named. Null when she looks at no chat: an idle or
 * thinking turn, a read of code, a draft for a chat not yet started.
 */
function herMarkOf(t: TFunction, activity: CompanionActivity | null, name: string): StationHerMark | null {
  const words = activity === null ? undefined : HER_WORDS[activity.phase];
  if (activity === null || activity.session === null || words === undefined) return null;
  return {
    sessionId: activity.session.sessionId,
    initial: Array.from(name)[0]?.toUpperCase() ?? '',
    words: t(words.key, { name, chat: activity.session.name, defaultValue: words.english }),
  };
}

/**
 * The left rail on the page, registered for the `sessions` slot in `stationRegions.ts`: it reads his sessions, the roadmap he
 * selected, her activity, the station's focus and the rail's two folds, and hands them to `WhereThingsStandView`.
 */
export function WhereThingsStand({ tier, density }: StationRegionProps) {
  const { t } = useTranslation();
  // His chats, the rows the chat's stage and her draft read too (null until the first read lands).
  const { sessions, failure, reread } = useStationSessions();
  // The roadmap lane's picture and the ONE roadmap he selected (a preference that follows him from device to device).
  const { picture, selected } = useRoadmap();
  // Her activity and her name, which draw her mark; her picture is null until its first read lands.
  const { picture: companionPicture } = useCompanion();
  const { focus, setFocus, scrollMemory } = useStation();
  // The two folds are remembered on this device, closed until he opens one: a rail that opened them on every visit would bury the open work under eleven asleep chats.
  const [asleepOpen, setAsleepOpen] = useStationPref('asleepOpen', false);
  const [completeOpen, setCompleteOpen] = useStationPref('completeOpen', false);

  // The roadmap's three readings: not known yet (the picture has not landed, or his preferences have not settled which of its
  // roadmaps is his), none (the picture holds no roadmap), or the one he selected.
  const roadmap = picture === null ? undefined : picture.roadmaps.length === 0 ? null : (selected ?? undefined);

  return (
    <WhereThingsStandView
      tier={tier}
      density={density}
      sessions={sessions}
      failure={failure}
      onReread={reread}
      roadmap={roadmap}
      focus={focus}
      her={herMarkOf(t, companionPicture?.activity ?? null, companionPicture?.settings.name ?? '')}
      asleepOpen={asleepOpen}
      onAsleepOpen={setAsleepOpen}
      completeOpen={completeOpen}
      onCompleteOpen={setCompleteOpen}
      // A press only stages its thing. Bringing the stage into view on a focus change is the one-column arrangement's work
      // (`useStationSection`, once, for every region's press), never this rail's.
      onPress={setFocus}
      // The rail's one scroller (see the view's ONE SCROLLER): `sessions` holds its place; no `roadmap` region is registered. The memory
      // follows the scroller only once BOTH sections are drawn: it puts the remembered place back as soon as the content is tall enough,
      // and the roadmap alone is (measured: 400 px remembered, 546–2098 px restored). The chats landing above it afterwards grew the
      // content over the reader's place, and the browser's scroll anchoring carried the view down with them.
      scrollRef={sessions !== null && roadmap !== undefined ? scrollMemory('sessions') : undefined}
    />
  );
}
