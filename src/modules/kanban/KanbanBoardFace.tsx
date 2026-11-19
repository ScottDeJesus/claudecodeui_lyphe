import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { KanbanRail } from '@/modules/kanban/KanbanRail';
import { foldedStatuses } from '@/modules/kanban/utils/lanePolicy';
import { Banner } from '@/shared/ui';

/**
 * THE BUGS VIEW'S BOARD FACE: the lane rail, and the one banner that explains a lane on it.
 *
 * IT IS THE PANEL'S RAIL, MOVED AND NOT CHANGED. The panel grew a second face (the dashboard) and a strip to switch
 * between the two; the rail and its banner came here so the panel stays the board's one owner of state under the file
 * ceiling. Every prop is the rail's own and is handed straight through: this file decides nothing about a lane.
 *
 * THE BANNER RIDES WITH THE RAIL rather than above every state: it explains a lane on the screen, and over a spinner
 * or an error would explain nothing the reader can see. Autonomy off hides no card and rewrites no status. They sit
 * in To Do wearing their own chip, and this says so once.
 */

type KanbanBoardFaceProps = ComponentProps<typeof KanbanRail> & {
  /** The open board's own setting: with it off, cards waiting on an answer are folded into To Do. */
  autonomy: boolean;
};

/** Rendered by KanbanPanel while its face is the board. Nothing else mounts it. */
export function KanbanBoardFace({ autonomy, ...rail }: KanbanBoardFaceProps) {
  const { t } = useTranslation();

  /** Cards To Do carries that wait on an answer — the questions row, and zero under autonomy. */
  const foldedQuestions = rail.board.countOf(foldedStatuses(autonomy));

  return (
    <>
      {!autonomy && foldedQuestions > 0 && (
        <Banner tone="info">{t('kanban.board.questionsFolded', { count: foldedQuestions })}</Banner>
      )}
      <KanbanRail {...rail} />
    </>
  );
}
