import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PlacesMenu } from '@/modules/project-workspace/PlacesMenu';
import { SessionFollowupsSwitch, SessionPanelSwitch } from '@/modules/session-panel';
import { openHome, openStation } from '@/shared/cloudcliDoors';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { Project, ProjectSession } from '@/shared/types';
import { Button } from '@/shared/ui';
import { WAY_BACK } from '@/shared/ui/overlayEscape';
import { getSessionTitle } from '@/shared/utils';

type ChatHeadProps = {
  /** The project the open chat belongs to; null before one is chosen. */
  selectedProject: Project | null;
  /** The open chat; null on a chat not yet begun. */
  selectedSession: ProjectSession | null;
  /** What a chat not yet begun is called. */
  newSessionLabel: string;
};

/**
 * THE HEAD OF A CHAT: the way back and what this is. A back arrow at the start goes back to the page the chat was reached from: Kaylee
 * Station when it was opened there, else the sessions home, where every chat is. ESCAPE PRESSES IT (`WAY_BACK`): the key is the way back out
 * of a chat, and no longer stops its turn, which the core's own Stop does. Beside it, the word Chat with the project's name, and
 * the chat's own title under them. At the end, where the chat has them: the toggle for its next
 * steps (`SessionFollowupsSwitch`) and the switch to its panel (`SessionPanelSwitch`); and always, last, the menu to every other
 * place (`PlacesMenu`). Nothing else: what the chat is doing is its core's to say (`ChatCore`), and everything that sets the chat up
 * is behind that core.
 *
 * It stands in place of the sidebar, the rail and the phone's header strip while the Chat view is on screen, at every width: the sessions
 * home is the list of chats now, and the other views are reached from its menu. `pwa-header-safe` keeps it clear of a phone's status bar.
 *
 * ITS ROW IS AS WIDE AS THE CHAT UNDER IT, and centred as it is, so the way back stands over the talk's left edge: 868 px, or the whole
 * of the chat's surface at a desk (`--chat-column`, which `ChatDesk` sets there).
 *
 * UNDER A FINGER IT IS ONE LINE, HALF AS TALL (32 px where it was 60): the words stand side by side, the title in the small size, and the
 * back arrow is drawn 28 px. The arrow still catches a finger at 44 px: a transparent `::before` grows the catch 8 px past the drawn box
 * on every side, the touch law's own way to grow a press without moving its neighbours. The paddings are `!important` there because
 * `pwa-header-safe` sets the top padding in plain CSS, which a utility alone does not outrank.
 *
 * Drawn by `WorkspaceMain`, as the head `ChatDesk` stands over the chat's pane.
 */
export default function ChatHead({ selectedProject, selectedSession, newSessionLabel }: ChatHeadProps) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  const title = selectedSession ? getSessionTitle(selectedSession) : newSessionLabel;
  const toStation = doors.cameFrom() === 'station';
  const back = toStation ? t('station.title', { defaultValue: 'Kaylee Station' }) : t('home.title', { defaultValue: 'Home' });

  return (
    <header data-chat-head="" className="pwa-header-safe flex-shrink-0 py-3 finger:!pb-0.5 finger:!pt-0.5">
      {/* The row is as wide as the chat under it, and centred as it is: the head is the chat's first line. */}
      <div className="mx-auto flex w-full max-w-[var(--chat-column,868px)] items-center gap-3 px-4 finger:gap-2 finger:px-3">
      <Button
        data-chat-head-back=""
        {...WAY_BACK}
        variant="outline"
        size="icon"
        className="relative size-9 shrink-0 finger:size-7 finger:before:absolute finger:before:-inset-2 finger:before:content-['']"
        aria-label={back}
        title={back}
        onClick={() => (doors.cameFrom() === 'station' ? openStation(doors.navigate) : openHome(doors.navigate))}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      {/* `min-w-0` on the flex child is what lets `truncate` work: without it a long title pushes the row wider than a phone. */}
      <div className="min-w-0 flex-1 finger:flex finger:items-baseline finger:gap-2">
        <p className="truncate font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground finger:max-w-[40%] finger:shrink-0">
          {[t('chatHead.chat', { defaultValue: 'Chat' }), selectedProject?.displayName].filter(Boolean).join(' · ')}
        </p>
        <h1 className="truncate text-xl font-normal leading-tight text-foreground finger:min-w-0 finger:text-sm" title={title}>{title}</h1>
      </div>
      {/* The chat's next steps, shown and put away from here; with none this draws nothing. */}
      <SessionFollowupsSwitch />
      {/* The chat's panel is a place switched to from here; with no panel this draws nothing. */}
      <SessionPanelSwitch />
      {/* The way to every other place, last in the head: the same menu the home and the station carry. */}
      <PlacesMenu here="chat" triggerClassName="relative size-9 flex-none finger:size-7 finger:before:absolute finger:before:-inset-2 finger:before:content-['']" />
      </div>
    </header>
  );
}
