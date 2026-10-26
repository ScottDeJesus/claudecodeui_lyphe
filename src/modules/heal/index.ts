import { lazy } from 'react';

// The heal module's public surface: the panel the Inbox's Heal section renders, and the one control
// another module draws.
// Lazy, the way the Memory and Runner panels are: the panel is the section's whole tree and loads on
// the section's first open, so importing this barrel for anything else never pulls it into the first
// page load.
export const HealPanel = lazy(() => import('@/modules/heal/HealPanel').then((m) => ({ default: m.HealPanel })));
// The context is NOT lazy: it is mounted in src/App.tsx beside MemoryIntakeProvider and ABOVE the
// Router, because the Inbox's waiting count (`useInboxWaiting`) reads `useHeal()` from outside the
// panel's own tree — which a lazy panel export could not reach.
export { HealProvider, useHeal } from '@/modules/heal/context/HealContext';
// The model switch, exported because it has a SECOND surface: Settings → Agents draws the same chip
// under the heal master (the switch the operator asked for lives on the Heal section, and the one screen every
// other runner switch lives on still has to show it). One component and not a second drawing of the
// same grammar — two chips that could disagree about which word a press writes are the exact bug the
// shared hook exists to prevent. Static, like the context: it is one chip, not a section's tree, and the
// row that renders it is not lazy.
export { HealModelSwitch } from '@/modules/heal/HealModelSwitch';
