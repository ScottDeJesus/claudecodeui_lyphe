import { lazy } from 'react';

// The heal module's public surface: the panel the Inbox's Heal section renders, and the pieces another
// module draws — the model switch, a heal card, a friction row, their two presses and the shapes they read.
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
// One heal card, exported because it has a SECOND surface: Cerberus's Uploads view draws each heal that claimed or cured the
// friction of a run with this same card, so a heal reads the same on both tabs and the two cannot disagree about it. Static,
// like the model switch: it is one card, not a section's tree, so the second surface renders it as a plain component with no
// Suspense around it (the panel above stays lazy).
export { HealCardView } from '@/modules/heal/HealCardView';
// The press a heal card's Open brief makes — the workspace's own opener on the heal's brief. Exported with the card because a
// card without it has nothing to open: the Uploads view hands this to `HealCardView` as its `onOpenChain`.
export { useOpenHealBrief } from '@/modules/heal/hooks/useOpenHealBrief';
// One friction row, as a kind opens to it, exported for the same second surface: the Uploads view draws the agent's own
// friction in a run with the rows the Friction by kind list opens to, so a row reads the same on both tabs. It draws one `<li>`.
export { HealItemRow } from '@/modules/heal/HealItemRow';
// The press a friction row's transcript ref makes — the workspace's own opener on the row's transcript line. Exported with the
// row for the same reason as the brief's: the Uploads view hands this to `HealItemRow` as its `onOpen`.
export { useOpenFrictionLine } from '@/modules/heal/hooks/useOpenFrictionLine';
// The shapes that second surface reads: one friction row, one heal card, and the worker's answer for a set of Claude sessions
// (`GET /api/heal/sessions`, through `api.heal.sessions`) — the rows filed in those sessions and the heals that claimed or cured them.
export type { HealCard, HealItem, HealSessionsAnswer } from '@/modules/heal/healTypes';
