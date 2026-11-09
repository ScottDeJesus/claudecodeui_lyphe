import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion';
import { useStation, useStationWhere } from '@/modules/station/context/StationContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { herMarkOf } from '@/modules/station/herMark';
import { SessionRow } from '@/modules/station/SessionRows';
import type { StationFocus, StationSession } from '@/shared/station-types';
import type { StationDensity, StationHerMark, StationRegionProps, StationTier } from '@/shared/types';
import { Badge, Button, ScrollArea } from '@/shared/ui';

/** The most chats the rim shows at once (Astrolabe's rim budget); the rest are one press away, in "Where things stand". */
const RIM_BUDGET = 3;

/** A chat that is running: working now, or stopped on something it asked you (a waiting chat still holds its run). */
const isRunning = (session: StationSession) => session.state === 'working' || session.state === 'waiting';

type LiveSessionsViewProps = {
  tier: StationTier;
  /** Taken and passed by every region; the rim draws its rows at full density, in the width the rim gives it. */
  density: StationDensity;
  /** Your chats in the companion's order (waiting on you, working, idle, asleep), or null until the first read lands. */
  sessions: StationSession[] | null;
  /** The thing on the stage: its row is lit, and it stays in the rim past the budget. */
  focus: StationFocus | null;
  /** The companion's mark: the chat it is reading, drafting for or walking, and its words; null while it looks at none. */
  her: StationHerMark | null;
  /** A row's press: its chat on the stage. */
  onPress: (focus: StationFocus) => void;
  /** "<n> more running": "Where things stand" opened, where every chat stands. */
  onMore: () => void;
};

/**
 * WHAT'S RUNNING, the scene's start rim (the `live` slot): what is happening elsewhere, the chats that are running now — working,
 * or waiting on you — in the companion's order, each as "Where things stand" draws it (`SessionRow`: its name, project and state,
 * the line the companion reads of it, the companion's mark when it looks at it) and each a press that puts the chat on the stage.
 *
 * QUIET UNTIL IT'S TRUE: it marks itself true (`data-station-true`) only while a chat is running, so the rim opens as the first
 * one starts and settles shut when the last one ends. Before the first read, after a failed one, and while every chat is idle or
 * asleep it is not true, and the rim takes no room: those chats, the roadmap and the failure are "Where things stand"'s, one press
 * away from the bar.
 *
 * THE BUDGET: at most three rows at once, the chat on the stage kept among them; past three, "<n> more running" opens "Where
 * things stand". The head counts every running chat.
 *
 * A pure view: `LiveSessions` below binds it, and the fixtures draw it on their pictures (`fake/live.ts`).
 */
export function LiveSessionsView({ tier, density, sessions, focus, her, onPress, onMore }: LiveSessionsViewProps) {
  const { t } = useTranslation();
  const headId = useId();
  const running = (sessions ?? []).filter(isRunning);
  const onStage = focus?.kind === 'chat' ? focus.sessionId : null;
  const shown = running.filter((session, at) => at < RIM_BUDGET || session.sessionId === onStage);
  const more = running.length - shown.length;

  return (
    <section
      data-station-live={running.length}
      data-station-true={running.length > 0 ? '' : undefined}
      aria-labelledby={headId}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      {/* The end rim's head, face for face (`WhatNeedsYouView`): the same box and the same 26 px line, so the two rims' hairlines meet across the scene. */}
      <header className="shrink-0 border-b border-border px-3 py-3 min-[1360px]:px-4">
        <h2 id={headId} className="flex min-h-[1.625rem] min-w-0 items-center gap-2 font-serif text-lg font-normal leading-tight text-foreground">
          {t('station.live.title', { defaultValue: 'What’s running' })}
          {' '}
          {running.length > 0 && <Badge as="span" tone="info" className="font-sans tabular-nums">{running.length}</Badge>}
        </h2>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-w-0 flex-col gap-1 px-2 py-3">
          <ul aria-labelledby={headId} className="flex min-w-0 flex-col">
            {shown.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                tier={tier}
                density={density}
                current={session.sessionId === onStage}
                her={her !== null && her.sessionId === session.sessionId ? her : null}
                onPress={onPress}
              />
            ))}
          </ul>
          {more > 0 && (
            <Button variant="ghost" size="sm" data-station-live-more="" className="self-start text-muted-foreground finger:h-11" onClick={onMore}>
              {t('station.live.more', { count: more, defaultValue_one: '{{count}} more running', defaultValue_other: '{{count}} more running' })}
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

/**
 * The start rim on the page, registered for the `live` slot in `stationRegions.ts`: it reads your chats from the station's sessions
 * (the rows "Where things stand" draws, never a read of its own), the companion's activity and name for its mark, and the stage,
 * and hands them to `LiveSessionsView`. Its "more" opens "Where things stand" (`useStationWhere`).
 */
export function LiveSessions({ tier, density }: StationRegionProps) {
  const { t } = useTranslation();
  const { sessions } = useStationSessions();
  const { picture } = useCompanion();
  const { focus, setFocus } = useStation();
  const where = useStationWhere();

  return (
    <LiveSessionsView
      tier={tier}
      density={density}
      sessions={sessions}
      focus={focus}
      her={herMarkOf(t, picture?.activity ?? null, picture?.settings.name ?? '')}
      onPress={setFocus}
      onMore={() => where.setOpen(true)}
    />
  );
}
