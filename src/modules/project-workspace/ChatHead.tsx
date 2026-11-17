import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SessionPanelSwitch } from '@/modules/session-panel';
import { openHome } from '@/shared/cloudcliDoors';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { Project, ProjectSession } from '@/shared/types';
import { Button } from '@/shared/ui';
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
 * THE HEAD OF A CHAT: the way back and what this is. A back arrow at the start goes to the sessions home, where every chat is; beside it,
 * the word Chat with the project's name, and the chat's own title under them. On a narrow screen a chat with a panel has the switch to
 * it at the end (`SessionPanelSwitch`). Nothing else: what the chat is doing is its core's to say, at the foot beside the line
 * (`ChatCore`), and everything that sets the chat up is behind that core.
 *
 * It stands in place of the sidebar, the rail and the phone's header strip while the Chat view is on screen, at every width: the sessions
 * home is the list of chats now, and the other views are reached from its menu. `pwa-header-safe` keeps it clear of a phone's status bar.
 *
 * UNDER A FINGER IT IS ONE LINE, HALF AS TALL (32 px where it was 60): the words stand side by side, the title in the small size, and the
 * back arrow is drawn 28 px. The arrow still catches a finger at 44 px: a transparent `::before` grows the catch 8 px past the drawn box
 * on every side, the touch law's own way to grow a press without moving its neighbours. The paddings are `!important` there because
 * `pwa-header-safe` sets the top padding in plain CSS, which a utility alone does not outrank.
 *
 * Drawn by `WorkspaceMain`, over the chat's pane.
 */
export default function ChatHead({ selectedProject, selectedSession, newSessionLabel }: ChatHeadProps) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  const title = selectedSession ? getSessionTitle(selectedSession) : newSessionLabel;
  const back = t('home.title', { defaultValue: 'Home' });

  return (
    <header data-chat-head="" className="pwa-header-safe flex flex-shrink-0 items-center gap-3 px-4 py-3 finger:gap-2 finger:px-3 finger:!pb-0.5 finger:!pt-0.5">
      <Button
        data-chat-head-back=""
        variant="outline"
        size="icon"
        className="relative size-9 shrink-0 finger:size-7 finger:before:absolute finger:before:-inset-2 finger:before:content-['']"
        aria-label={back}
        title={back}
        onClick={() => openHome(doors.navigate)}
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
      {/* On a narrow screen the chat's panel is a place switched to from here; at a desk it is beside the talk and this draws nothing. */}
      <SessionPanelSwitch />
    </header>
  );
}
