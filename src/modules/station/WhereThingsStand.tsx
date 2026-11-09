import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion';
import { useRoadmap } from '@/modules/roadmap';
import { useStation, useStationPref } from '@/modules/station/context/StationContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { herMarkOf } from '@/modules/station/herMark';
import { RoadmapRows } from '@/modules/station/RoadmapRows';
import { SessionRows } from '@/modules/station/SessionRows';
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
 * NO HEAD OF ITS OWN: wherever it is drawn something else names it — the scene's sheet "Where things stand" (full density, one
 * call away from the bar), the one-column arrangement's section switch (compact) — so the scroller carries the name as its
 * `aria-label` and the Sessions and Roadmap eyebrows lead.
 *
 * AT COMPACT DENSITY each chat and each feature is one line, the epics and the two folds as in full, the two sections closer
 * together; the rail's one scroller fills the section it is given.
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
  const compact = density === 'compact';
  const name = t('station.rail.name', { defaultValue: 'Where things stand' });
  return (
    <>
      <ScrollArea
        ref={scrollRef}
        role="region"
        aria-label={name}
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
