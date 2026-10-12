import { useTranslation } from 'react-i18next';

import { NodeCard } from '@/modules/cerberus/fleet/NodeCard';
import type { CerberusSheetTarget, FleetEntry } from '@/shared/types';
import { Button, Card } from '@/shared/ui';

type FleetListProps = {
  /** The page, worst first. */
  entries: FleetEntry[];
  /** How many nodes "Show N more" adds; 0 when the page already holds them all. */
  moreCount: number;
  /** The tab is narrow: each row's warden line moves from the row's end into its open band. */
  narrow: boolean;
  /** The read's own moment, for the warden lines. */
  now: number;
  onToggle: (id: string, open: boolean) => void;
  onOpenCell: (target: CerberusSheetTarget) => void;
  onShowMore: () => void;
};

/**
 * FLEET AS A LIST: one framed column, a row per node, worst first. A row reads across — glyph, name
 * and description, its service squares, its one line, its warden — and opens a band under itself with
 * its services' last 30 minutes. Past the first page, "Show N more" adds the next; `FleetView` sizes
 * the pages.
 *
 * Used by Fleet's `FleetView` while the layout is List.
 */
export function FleetList({ entries, moreCount, narrow, now, onToggle, onOpenCell, onShowMore }: FleetListProps) {
  const { t } = useTranslation();
  return (
    <>
      <Card className="overflow-hidden">
        {entries.map(({ item, node, open }, index) => (
          <NodeCard
            key={item.id}
            item={item}
            node={node}
            open={open}
            face="list"
            index={index}
            narrow={narrow}
            now={now}
            onToggle={onToggle}
            onOpenCell={onOpenCell}
          />
        ))}
      </Card>
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
