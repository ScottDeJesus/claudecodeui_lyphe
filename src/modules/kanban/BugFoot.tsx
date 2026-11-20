import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Tabs } from '@/shared/ui';

/** The view's three faces: the board (the instrument at home), its numbers, and the features proposed from it. */
export type BugFace = 'board' | 'dashboard' | 'proposed';

type BugFootProps = {
  face: BugFace;
  onFace: (face: BugFace) => void;
  /** The open board's open high cards, for the Dashboard face's count; undefined while the board is read. */
  openHigh?: number;
  /** The open proposals, and how many of them are high, for the Proposed face's count; undefined while they are read. */
  openProposals?: number;
  openHighProposals?: number;
  /** Makes a bug and opens it; absent while there is no board to make it on. */
  onNewBug?: () => void;
  /** The instrument, docked: drawn at the foot's start while another face is the work, and a press there is the way back to it. */
  docked: ReactNode;
};

/**
 * THE FOOT OF THE BUGS VIEW: the docked instrument at the start while the board's numbers or its proposals are the work above
 * (still live: a mark still turns the accent there, and a press on it brings the board back), and in the middle the controls for
 * what is present: the switch between the three faces, and, on the board, the plus that makes a bug (its mark alone, as the
 * design system's file button is: the word is its title and its name).
 *
 * The faces keep the old strip's names and counts (the Dashboard counts the open high cards, Proposed features the open proposals,
 * warm only while one of them is high), so nothing a reader counted on is lost with the strip. Drawn by the panel (`KanbanPanel`).
 */
export function BugFoot({ face, onFace, openHigh, openProposals, openHighProposals, onNewBug, docked }: BugFootProps) {
  const { t } = useTranslation();
  const newBug = t('kanban.ring.newBug', { defaultValue: 'New bug' });

  return (
    // Three columns: the docked instrument at the start, the controls in the middle, and the same room again at the end, so the
    // controls stand in the middle of the foot whatever the start holds.
    <footer data-bug-foot="" className="grid h-[84px] flex-none grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 pb-[var(--safe-area-inset-bottom)] md:h-[100px] md:gap-3 md:px-7">
      <div className="flex min-w-0 items-center">
        {face !== 'board' && (
          <button
            type="button"
            data-bug-docked=""
            aria-label={t('kanban.faces.board')}
            title={t('kanban.faces.board')}
            onClick={() => onFace('board')}
            className="size-11 flex-none rounded-full outline-none transition-transform duration-150 hover:scale-[1.04] focus-visible:ring-1 focus-visible:ring-ring md:size-[84px]"
          >
            {/* The instrument takes no press of its own here: the button round it is the press. */}
            <span className="pointer-events-none block size-full">{docked}</span>
          </button>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {/* Under a finger each face is a 44 px press, its word on one line and a little smaller, so the three and the plus fit a phone. */}
        <div className="min-w-0 [&_[role=tab]]:whitespace-nowrap finger:[&_[role=tab]]:min-h-11 finger:[&_[role=tab]]:px-2 finger:[&_[role=tab]]:text-[12.5px]">
          <Tabs
            variant="segmented"
            ariaLabel={t('kanban.faces.label')}
            active={face}
            onChange={(id) => onFace(id === 'dashboard' || id === 'proposed' ? id : 'board')}
            tabs={[
              { id: 'board', label: t('kanban.faces.board') },
              { id: 'dashboard', label: t('kanban.faces.dashboard'), count: openHigh, attention: openHigh ? t('kanban.faces.openHigh', { count: openHigh }) : undefined },
              { id: 'proposed', label: t('kanban.faces.proposed'), count: openProposals, attention: openHighProposals ? t('kanban.faces.openHighProposals', { count: openHighProposals }) : undefined },
            ]}
          />
        </div>
        {face === 'board' && onNewBug && (
          <Button variant="outline" size="icon" data-bug-new="" aria-label={newBug} title={newBug} onClick={onNewBug} className="size-9 shrink-0 finger:size-11">
            <Plus aria-hidden="true" />
          </Button>
        )}
      </div>
    </footer>
  );
}
