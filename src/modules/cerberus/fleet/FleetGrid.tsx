import { useTranslation } from 'react-i18next';

import { NodeCard } from '@/modules/cerberus/fleet/NodeCard';
import type { CerberusSheetTarget, FleetEntry } from '@/shared/types';
import { Button } from '@/shared/ui';

type FleetGridProps = {
  /** The page, worst first. */
  entries: FleetEntry[];
  /** How many nodes "Show N more" adds; 0 when the page already holds them all. */
  moreCount: number;
  /** The read's own moment, for the warden lines. */
  now: number;
  onToggle: (id: string, open: boolean) => void;
  onOpenCell: (target: CerberusSheetTarget) => void;
  onShowMore: () => void;
};

/**
 * FLEET AS A GRID: a tile per node, as many to a row as fit at 150px or more each, worst first. A node
 * that opens spans the whole row, on the line after the nodes before it, and the nodes after it follow
 * it. The grid is not packed `dense`: that would pull the later tiles up into the short row above an
 * open card, reorder the fleet on screen and leave the keyboard walking a different order than the eye.
 * Worst first holds, and a short row is the price. Past the first page, "Show N more" adds the next.
 *
 * Used by Fleet's `FleetView` while the layout is Grid.
 */
export function FleetGrid({ entries, moreCount, now, onToggle, onOpenCell, onShowMore }: FleetGridProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {entries.map(({ item, node, open }, index) => (
          <NodeCard
            key={item.id}
            item={item}
            node={node}
            open={open}
            face="grid"
            index={index}
            now={now}
            onToggle={onToggle}
            onOpenCell={onOpenCell}
          />
        ))}
      </div>
      {moreCount > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={onShowMore}>
            {t('cerberus.fleet.showMore', { count: moreCount })}
          </Button>
        </div>
      )}
    </>
  );
}
