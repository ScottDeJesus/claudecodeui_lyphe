import { ArrowLeft } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { PlacesMenu } from '@/modules/project-workspace/PlacesMenu';
import { SessionFollowupsSwitch, SessionPanelSwitch } from '@/modules/session-panel';
import { openHome, openStation } from '@/shared/cloudcliDoors';
import { HEAD_NAME, HEAD_PRESS, HEAD_ROW, HOLDS_TRAIL } from '@/shared/constants';
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
  /** The width of the desk's column beside the chat, in px (`ChatDesk`'s `side`); 0 where the chat has none (a narrow window, a phone). */
  side?: number;
};

/**
 * THE HEAD OF A CHAT: the way back and what this is. A back arrow at the start goes back to the page the chat was reached from: Kaylee
 * Station when it was opened there, else the sessions home, where every chat is. ESCAPE PRESSES IT (`WAY_BACK`): the key is the way back out
 * of a chat, and no longer stops its turn, which the core's own Stop does. HELD, it opens the trail (`HOLDS_TRAIL`): every place the
 * reader has been, any of them one press away. Beside it, the word Chat with the project's name, and
 * the chat's own title under them. At the end, where the chat has them: the toggle for its next
 * steps (`SessionFollowupsSwitch`) and the switch to its panel (`SessionPanelSwitch`); and always, last, the menu to every other
 * place (`PlacesMenu`). Nothing else: what the chat is doing is its core's to say (`ChatCore`), and everything that sets the chat up
 * is behind that core.
 *
 * It stands in place of the sidebar, the rail and the phone's header strip while the Chat view is on screen, at every width: the sessions
 * home is the list of chats now, and the other views are reached from its menu. `pwa-header-safe` keeps it clear of a phone's status bar.
 *
 * IT IS EVERY SCREEN'S HEAD (`HEAD_ROW`), AND IT STANDS OVER THE DESK. At a desk the chat and the column beside it are one block in the
 * middle of the window (`ChatDesk`), and the head keeps to that block (`data-chat-head-desk`, `chatDesk.css`): the way back stands over
 * the column's start and the menu over the end of the chat's surface, never at the window's corners with the block between them. In a
 * window no wider than the block, and with no column (a narrow window, a phone), it is the window's width. Under a finger it is one line: the words side by side,
 * the title in the small size, the arrow and the menu drawn 28 px and still caught at 44 (`HEAD_PRESS`).
 *
 * Drawn by `WorkspaceMain`, over the chat's pane (`ChatDesk`).
 */
export default function ChatHead({ selectedProject, selectedSession, newSessionLabel, side = 0 }: ChatHeadProps) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  const title = selectedSession ? getSessionTitle(selectedSession) : newSessionLabel;
  const toStation = doors.cameFrom() === 'station';
  const back = toStation ? t('station.title', { defaultValue: 'Kaylee Station' }) : t('home.title', { defaultValue: 'Home' });

  return (
    <header
      data-chat-head=""
      data-chat-head-desk={side > 0 ? '' : undefined}
      className={HEAD_ROW}
      style={side > 0 ? ({ '--chat-side': `${side}px` } as CSSProperties) : undefined}
    >
      <Button
        data-chat-head-back=""
        {...WAY_BACK}
        {...HOLDS_TRAIL}
        variant="outline"
        size="icon"
        className={HEAD_PRESS}
        aria-label={back}
        title={back}
        onClick={() => (doors.cameFrom() === 'station' ? openStation(doors.navigate) : openHome(doors.navigate))}
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      {/* `min-w-0` on the flex child is what lets `truncate` work: without it a long title pushes the row wider than a phone. The
          eyebrow and the title fill the press's height together at a desk (12 and 24 px). */}
      <div className={HEAD_NAME}>
        <div className="min-w-0 finger:flex finger:items-baseline finger:gap-2">
          <p className="truncate font-mono text-[10px] font-medium uppercase leading-3 tracking-[0.18em] text-muted-foreground finger:max-w-[40%] finger:shrink-0">
            {[t('chatHead.chat', { defaultValue: 'Chat' }), selectedProject?.displayName].filter(Boolean).join(' · ')}
          </p>
          <h1 className="truncate text-xl font-normal leading-6 text-foreground finger:min-w-0 finger:text-sm" title={title}>{title}</h1>
        </div>
      </div>
      {/* The chat's next steps, shown and put away from here; with none this draws nothing. */}
      <SessionFollowupsSwitch />
      {/* The chat's panel is a place switched to from here; with no panel this draws nothing. */}
      <SessionPanelSwitch />
      {/* The way to every other place, last in the head: the same menu at the same end as on every page's head. */}
      <PlacesMenu />
    </header>
  );
}
