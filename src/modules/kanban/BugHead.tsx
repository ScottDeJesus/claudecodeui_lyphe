import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanBoard } from '@/shared/kanban-types';
import { openHome, openStation } from '@/shared/cloudcliDoors';
import { HEAD_NAME, HEAD_PRESS, HEAD_ROW, HOLDS_TRAIL } from '@/shared/constants';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import { Button, Select } from '@/shared/ui';
import { WAY_BACK } from '@/shared/ui/overlayEscape';

type BugHeadProps = {
  boards: KanbanBoard[];
  currentBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  onNewBoard: () => void;
  /** The way to every other place, the workspace's (`PlacesMenu`), last in the head. */
  menu: ReactNode;
};

/**
 * THE HEAD OF THE BUGS VIEW, as the chat's head is drawn: the way back at the start (Kaylee Station when the screen was reached
 * from there, else the sessions home; Escape presses it, `WAY_BACK`; held, it opens the trail of places, `HOLDS_TRAIL`), then what this is: BUGS, and the board's name, which is its
 * picker (the old header's switcher, under the same name, with New board under its list), the two on one line. At the end the menu to
 * every other place. Nothing else: what the board is doing is its instrument's to say, and everything that sets the board up is behind
 * its core. It is drawn in every screen's head row (`HEAD_ROW`), so its arrow and its menu stand on the same spot as on every page.
 *
 * It stands in place of the sidebar, the rail and the phone's strip while the Bugs view is on screen (`WorkspaceMain` and
 * `ProjectSidebarRegion` leave them out). Drawn by the panel (`KanbanPanel`).
 */
export function BugHead({ boards, currentBoardId, onSelectBoard, onNewBoard, menu }: BugHeadProps) {
  const { t } = useTranslation();
  const doors = useStationDoors();
  const toStation = doors.cameFrom() === 'station';
  const back = toStation ? t('station.title', { defaultValue: 'Kaylee Station' }) : t('home.title', { defaultValue: 'Home' });

  return (
    <header data-bug-head="" className={HEAD_ROW}>
      <Button
        data-bug-head-back=""
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
      <div className={`${HEAD_NAME} gap-2.5`}>
        <p className="shrink-0 font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.18em] text-muted-foreground">
          {t('kanban.ring.eyebrow', { defaultValue: 'Bugs' })}
        </p>
        <div className="w-full min-w-0 max-w-64">
          <Select
            options={boards.map((board) => ({ value: board.id, label: board.name }))}
            value={currentBoardId ?? ''}
            onChange={onSelectBoard}
            placeholder={t('kanban.board.noBoard')}
            ariaLabel={t('kanban.board.switcher')}
            size="sm"
            action={{ label: t('kanban.board.newBoard'), onSelect: onNewBoard }}
          />
        </div>
      </div>
      {menu}
    </header>
  );
}
