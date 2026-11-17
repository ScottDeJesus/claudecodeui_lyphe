import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
 * the word Chat with the project's name, and the chat's own title under them. Nothing else: what the chat is doing is its core's to say,
 * at the foot beside the line (`ChatCore`), and everything that sets the chat up is behind that core.
 *
 * It stands in place of the sidebar, the rail and the phone's header strip while the Chat view is on screen, at every width: the sessions
 * home is the list of chats now, and the other views are reached from its menu. `pwa-header-safe` keeps it clear of a phone's status bar.
 *
 * Drawn by `WorkspaceMain`, over the chat's pane.
 */
export default function ChatHead({ selectedProject, selectedSession, newSessionLabel }: ChatHeadProps) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  const title = selectedSession ? getSessionTitle(selectedSession) : newSessionLabel;
  const back = t('home.title', { defaultValue: 'Home' });

  return (
    <header data-chat-head="" className="pwa-header-safe flex flex-shrink-0 items-center gap-3 px-3 py-2 sm:px-4 sm:py-3">
      <Button
        data-chat-head-back=""
        variant="outline"
        size="icon"
        className="size-9 shrink-0 finger:size-11"
        aria-label={back}
        title={back}
        onClick={() => openHome(doors.navigate)}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      {/* `min-w-0` on the flex child is what lets `truncate` work: without it a long title pushes the row wider than a phone. */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground">
          {[t('chatHead.chat', { defaultValue: 'Chat' }), selectedProject?.displayName].filter(Boolean).join(' · ')}
        </p>
        <h1 className="truncate text-lg font-normal leading-tight text-foreground sm:text-xl" title={title}>{title}</h1>
      </div>
    </header>
  );
}
