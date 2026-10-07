import { useTranslation } from 'react-i18next';

import type { FleetFilter, FleetFilterGroup, FleetLayout } from '@/shared/types';
import { Button, Chip, Input, Tabs } from '@/shared/ui';

/** The layouts, in the order the toolbar offers them. */
const LAYOUTS: FleetLayout[] = ['grid', 'list', 'rings'];

type FleetToolbarProps = {
  layout: FleetLayout;
  /** Every filter with its live count over the whole fleet (`filterGroups`). */
  groups: FleetFilterGroup[];
  filter: FleetFilter;
  query: string;
  /** Whether Expand all and Collapse all are offered: not in Rings, which opens one node at a time, and not while the tab is narrow. */
  folds: boolean;
  onLayout: (layout: FleetLayout) => void;
  onFilter: (filter: FleetFilter) => void;
  onQuery: (query: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
};

/**
 * THE FLEET'S TOOLBAR, one row that wraps: the layout (Grid · List · Rings), a chip per filter with its
 * live count ("Needs you · 2"), the search box, and Expand all / Collapse all.
 *
 * A filter with nothing in it is not offered, so the row only names what is there; the chosen one
 * stays even at zero, so the reader can see what is filtering the empty list and pick All again. The
 * counts are the whole fleet's, so typing a search never changes what a chip says.
 *
 * Used by Fleet's `FleetView`, above the status bar.
 */
export function FleetToolbar({ layout, groups, filter, query, folds, onLayout, onFilter, onQuery, onExpandAll, onCollapseAll }: FleetToolbarProps) {
  const { t } = useTranslation();
  const offered = groups.filter(({ group, count }) => group === 'all' || count > 0 || group === filter);

  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
      <Tabs
        tabs={LAYOUTS.map((id) => ({ id, label: t(`cerberus.fleet.layouts.${id}`) }))}
        active={layout}
        onChange={(id) => {
          const next = LAYOUTS.find((candidate) => candidate === id);
          if (next) onLayout(next);
        }}
        ariaLabel={t('cerberus.fleet.layouts.label')}
      />
      <div role="group" aria-label={t('cerberus.fleet.filters.title')} className="flex min-w-0 flex-[1_1_300px] flex-wrap gap-1.5">
        {offered.map(({ group, count }) => (
          <Chip key={group} size="sm" selected={group === filter} onClick={() => onFilter(group)}>
            {t('cerberus.fleet.filters.label', { name: t(`cerberus.fleet.filters.${group}`), count })}
          </Chip>
        ))}
      </div>
      <div className="min-w-[150px] max-w-[340px] flex-[1_1_200px]">
        <Input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t('cerberus.fleet.searchPlaceholder')}
          aria-label={t('cerberus.fleet.searchPlaceholder')}
        />
      </div>
      {folds && (
        <div className="flex gap-0.5">
          <Button variant="ghost" size="sm" onClick={onExpandAll}>
            {t('cerberus.fleet.expandAll')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCollapseAll}>
            {t('cerberus.fleet.collapseAll')}
          </Button>
        </div>
      )}
    </div>
  );
}
