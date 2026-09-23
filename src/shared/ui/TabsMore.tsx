import { MoreHorizontal } from 'lucide-react';

import { Menu } from '@/shared/ui/Menu';
import type { TabItem } from '@/shared/ui/Tabs';

/**
 * The trigger's face: a tab-shaped glyph, wearing the dot an icon tab wears when something the
 * menu holds is waiting — the same mark in the same place, so a count that collapsed is not a
 * count that vanished. Used by Tabs.tsx twice: inside the trigger, and in the ghost row that
 * measures it (useTabsOverflow.ts).
 */
export function MoreFace({ waiting }: { waiting: boolean }) {
  return (
    <span className="vv-tabs__tab vv-tabs__tab--icon vv-tabs__more">
      <span className="vv-tabs__glyph">
        <MoreHorizontal className="vv-tabs__icon" strokeWidth={2} />
        {waiting && <span className="vv-tabs__dot" aria-hidden="true" />}
      </span>
    </span>
  );
}

type TabsMoreProps = {
  /** The trigger's accessible name and hover title — the strip's `overflowLabel`. */
  label: string;
  /** The collapsed tabs, in strip order. */
  tabs: TabItem[];
  onSelect: (id: string) => void;
};

/**
 * An overflowing row's last stop, used by Tabs.tsx alone: the kit's Menu, listing the collapsed
 * tabs by their words — never their glyphs, which is what the row had no room for — with each
 * one's count out loud.
 */
export function TabsMore({ label, tabs, onSelect }: TabsMoreProps) {
  return (
    <Menu
      trigger={<MoreFace waiting={tabs.some((tab) => (tab.count ?? 0) > 0)} />}
      triggerLabel={label}
      items={tabs.map((tab) => ({ id: tab.id, label: tab.label, count: tab.count }))}
      onSelect={onSelect}
      // The trigger ends the row, so the panel opens back across it rather than off the edge.
      align="right"
    />
  );
}
