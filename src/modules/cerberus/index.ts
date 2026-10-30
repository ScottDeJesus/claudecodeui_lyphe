import { lazy } from 'react';

// The Cerberus module's public surface: the provider App mounts, the one count the views
// rail reads, the tab's pane, and what the station draws and reads of a red check (its need, its card, its sheet). The context's
// verbs, the other views and the dialogs stay inside the module — each file there imports its siblings
// by path, never through this barrel.

// Mounted by src/App.tsx beside HealProvider, ABOVE the Router and inside the auth gate: the tab's
// views, its header and the rail's badge all read the one overview it keeps, so it cannot live
// inside the tab's own tree.
export { CerberusProvider } from '@/modules/cerberus/context/CerberusProvider';

// Read by src/modules/project-workspace (useRailBadges, for the Cerberus glyph's badge on the views rail): how many checks need a person right now, `0` until the first read answers.
export { useCerberusNeeds } from '@/modules/cerberus/context/CerberusContext';
// Read by src/modules/station (CheckStage): one check's entry in "Needs you" by its node and key, `undefined` until the overview is
// read and `null` once the check needs no one, which is how the stage knows the check it was opened on has recovered.
export { useCerberusNeedOf } from '@/modules/cerberus/context/CerberusContext';

// Drawn by src/modules/station (CheckStage): a red check on the station's stage is Cerberus's own card for it, with its fix
// to run and Diagnose as the tab offers them (and no Mute: the station hosts no Mute dialog), its reported value whole
// (`wholeValue`: the stage is where the rail's cut line stands whole), and "Open the check" is
// Cerberus's own sheet on it, over the station's right side. Both read the provider App mounts; the sheet's target is
// `CerberusSheetTarget` (src/shared/types.ts).
export { NeedCard } from '@/modules/cerberus/fleet/NeedsYouCard';
export { CheckSheet } from '@/modules/cerberus/sheet/CheckSheet';

// The Cerberus tab's pane, mounted by src/modules/project-workspace (WorkspaceMain): the fleet's
// health under its header, Fleet and History beneath, with the check sheet and the Mute and Enroll
// dialogs over them. It takes the workspace's `projectChoices`, which a co-located node's card offers
// in "Run a project here": the workspace owns that list and imports this module, so it is handed down.
// Lazy: the panel is its tab's whole tree and loads on the tab's first open, so importing this
// barrel for anything else never pulls the panel into the first page load.
export const CerberusPanel = lazy(() => import('@/modules/cerberus/CerberusPanel').then((m) => ({ default: m.CerberusPanel })));
