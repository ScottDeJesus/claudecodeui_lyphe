import { lazy } from 'react';

// The heal module's public surface: the panel the Heal tab renders, and the one control another
// module draws.
// Lazy, the way the Memory and Runner panels are: the panel is its tab's whole tree and loads on
// the tab's first open, so importing this barrel for anything else never pulls it into the first
// page load.
export const HealPanel = lazy(() => import('@/modules/heal/HealPanel').then((m) => ({ default: m.HealPanel })));
// The context is NOT lazy: it is mounted in src/App.tsx beside MemoryIntakeProvider and ABOVE the
// Router, because the workspace's tab gates and the command palette read `useHeal()` from outside the
// panel's own tree — none of which a lazy panel export could reach.
export { HealProvider, useHeal } from '@/modules/heal/context/HealContext';
// The model switch, exported because it has a SECOND surface: Settings → Agents draws the same chip
// under the heal master (the switch the operator asked for lives on the tab, and the one screen every
// other runner switch lives on still has to show it). One component and not a second drawing of the
// same grammar — two chips that could disagree about which word a press writes are the exact bug the
// shared hook exists to prevent. Static, like the context: it is one chip, not a tab's tree, and the
// row that renders it is not lazy.
export { HealModelSwitch } from '@/modules/heal/HealModelSwitch';
