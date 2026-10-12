import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FleetGrid } from '@/modules/cerberus/fleet/FleetGrid';
import { FleetList } from '@/modules/cerberus/fleet/FleetList';
import { applyFilter, defaultExpanded, filterGroups, fleetItems } from '@/modules/cerberus/fleet/fleetModel';
import { FleetRings } from '@/modules/cerberus/fleet/FleetRings';
import { FleetLegend, FleetStatusBar } from '@/modules/cerberus/fleet/FleetStatusBar';
import { FleetToolbar } from '@/modules/cerberus/fleet/FleetToolbar';
import { NeedsYouCard } from '@/modules/cerberus/fleet/NeedsYouCard';
import { WhatHappenedCard } from '@/modules/cerberus/fleet/WhatHappenedCard';
import type { CerberusCheckView, CerberusOverview } from '@/shared/cerberus-types';
import type { CerberusSheetTarget, FleetEntry, FleetFilter, FleetLayout } from '@/shared/types';

/** How many nodes the first page holds: a list row is shorter than a tile, so the list stops sooner. */
const FIRST_PAGE = { grid: 120, list: 80 } as const;

/** How many more nodes each "Show N more" adds. */
const PAGE_STEP = 120;

type FleetViewProps = {
  /** The fleet as center last answered it. The tab's root draws loading and unreachable while it has none, so the view always has one. */
  overview: CerberusOverview;
  /** The tab is narrow (the root's container query): Expand all and Collapse all step aside, and a list row's warden line moves into its band. */
  narrow: boolean;
  /** Opens the check sheet: a minute at its worst check, a service row, or a Needs-you card. */
  onOpenCell: (target: CerberusSheetTarget) => void;
  /** Opens the Mute dialog on a check. */
  onMute: (check: CerberusCheckView) => void;
};

/**
 * THE FLEET, the tab's first view, read top to bottom in the order a person needs it:
 * 1. Needs you: what to look at now, or "✓ Nothing needs you".
 * 2. Beside What happened (under it on a phone):
 *    - the toolbar: Grid · List · Rings, a chip per filter with its count, the search, Expand all and
 *      Collapse all;
 *    - the fleet at a glance, a bar and its words;
 *    - the nodes, worst first, in the layout chosen, or a sentence when the filter and the search
 *      leave none;
 *    - the key to the minutes.
 *
 * The nodes are the fleet model's: worst first, counted into the filters, searched, and open on their
 * own when they need you in a fleet of twelve or fewer. A node opened or closed by hand stays so,
 * whatever the fleet does. The view pages a long fleet and never draws thousands of cards at once.
 *
 * The view holds its own layout, filter, search, open nodes and page. The sheet and the Mute dialog are
 * the root's, reached through `onOpenCell` and `onMute`.
 *
 * Used by the cerberus module's root, `CerberusPanel`, as the Fleet tab.
 */
export function FleetView({ overview, narrow, onOpenCell, onMute }: FleetViewProps) {
  const { t } = useTranslation();

  // Every node as an item, worst first: the one order the grid, the list and the rings share.
  const items = useMemo(() => fleetItems(overview), [overview]);
  // Each filter with its live count over the whole fleet, so a search narrows what a chip lists and never what it says.
  const groups = useMemo(() => filterGroups(items), [items]);
  // What the toolbar's Grid · List · Rings picked. Essential: it is the person's choice and no read holds it.
  const [layout, setLayout] = useState<FleetLayout>('grid');
  // The filter chip picked. Essential for the same reason; the fleet's counts come from the read, the pick does not.
  const [filter, setFilter] = useState<FleetFilter>('all');
  // What is typed in the search box, as typed: the box is controlled by it, and `applyFilter` trims it.
  const [query, setQuery] = useState('');
  // The nodes a person opened (true) or closed (false) by hand, by node id. They win over `defaultExpanded`,
  // which is read off the WHOLE fleet so a search never changes what opens; a node left out here follows it.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const opensOnItsOwn = defaultExpanded(items);
  // How many nodes the page holds once "Show N more" has been pressed; null is the first page. A filter or a
  // search sends it back to null, so a new list always opens at its top.
  const [limit, setLimit] = useState<number | null>(null);
  // The filter's nodes that the search matches, worst first.
  const shown = useMemo(() => applyFilter(items, filter, query), [items, filter, query]);

  const onLayout = (next: FleetLayout) => setLayout(next);
  const onFilter = (next: FleetFilter) => {
    setFilter(next);
    setLimit(null);
  };
  const onQuery = (next: string) => {
    setQuery(next);
    setLimit(null);
  };
  const onToggle = (id: string, open: boolean) => setToggled((current) => ({ ...current, [id]: open }));
  // Expand all and Collapse all write an entry for every node of the page, so they are a hand's work like a click: a later read does not undo them.
  const onExpandAll = () => setToggled((current) => ({ ...current, ...Object.fromEntries(page.map((item) => [item.id, true])) }));
  const onCollapseAll = () => setToggled((current) => ({ ...current, ...Object.fromEntries(page.map((item) => [item.id, false])) }));
  const onShowMore = () => setLimit(page.length + PAGE_STEP);

  // The rings draw every node at once; Grid and List draw a page of them.
  const page = layout === 'rings' ? shown : shown.slice(0, limit ?? FIRST_PAGE[layout]);
  const moreCount = Math.min(PAGE_STEP, shown.length - page.length);
  const nodeById = new Map(overview.nodes.map((node) => [node.id, node]));
  const entries: FleetEntry[] = page.flatMap((item) => {
    const node = nodeById.get(item.id);
    // An own entry only: `toggled['constructor']` would read Object's, and a node by that legal name would open unasked.
    const byHand = Object.prototype.hasOwnProperty.call(toggled, item.id) ? toggled[item.id] : undefined;
    return node === undefined ? [] : [{ item, node, open: byHand ?? opensOnItsOwn.has(item.id) }];
  });
  const typed = query.trim();

  return (
    <div className="flex flex-col gap-[18px] px-[clamp(16px,4cqi,32px)] pb-7 pt-5">
      <NeedsYouCard
        needs={overview.needsYou}
        muted={overview.muted}
        counts={overview.counts}
        now={overview.now}
        onOpen={onOpenCell}
        onMute={onMute}
      />
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[3_1_620px] flex-col gap-3.5">
          <FleetToolbar
            layout={layout}
            groups={groups}
            filter={filter}
            query={query}
            folds={!narrow && layout !== 'rings'}
            onLayout={onLayout}
            onFilter={onFilter}
            onQuery={onQuery}
            onExpandAll={onExpandAll}
            onCollapseAll={onCollapseAll}
          />
          <FleetStatusBar groups={groups} listed={shown.length} drawn={page.length} />
          {shown.length === 0 && (
            <p className="rounded-xl border-[1.5px] border-dashed border-input px-5 py-[18px] text-[13.5px] text-muted-foreground">
              {typed === '' ? t('cerberus.fleet.noneInGroup') : t('cerberus.fleet.noMatch', { query: typed })}
            </p>
          )}
          {shown.length > 0 && layout === 'grid' && (
            <FleetGrid entries={entries} moreCount={moreCount} now={overview.now} onToggle={onToggle} onOpenCell={onOpenCell} onShowMore={onShowMore} />
          )}
          {shown.length > 0 && layout === 'list' && (
            <FleetList
              entries={entries}
              moreCount={moreCount}
              narrow={narrow}
              now={overview.now}
              onToggle={onToggle}
              onOpenCell={onOpenCell}
              onShowMore={onShowMore}
            />
          )}
          {shown.length > 0 && layout === 'rings' && (
            <FleetRings
              // The hub stays at the centre whatever the filter and the search leave: the rings are drawn around it.
              items={[...items.filter((item) => item.role === 'hub' && !shown.includes(item)), ...shown]}
              nodes={overview.nodes}
              now={overview.now}
              onOpenCell={onOpenCell}
            />
          )}
          <FleetLegend />
        </div>
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3.5">
          <WhatHappenedCard activity={overview.activity} now={overview.now} />
        </div>
      </div>
    </div>
  );
}
