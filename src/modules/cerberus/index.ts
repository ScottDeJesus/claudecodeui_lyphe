// The Cerberus module's public surface: the provider App mounts, and the one count the workspace
// strip reads. The context's verbs, the views, the sheet and the dialogs stay inside the module —
// each file there imports its siblings by path, never through this barrel.

// Mounted by src/App.tsx beside HealProvider, ABOVE the Router and inside the auth gate: the tab's
// views, its header and the strip's count pill all read the one overview it keeps, so it cannot live
// inside the tab's own tree.
export { CerberusProvider } from '@/modules/cerberus/context/CerberusProvider';

// For src/modules/project-workspace's tab strip, whose count pill the workspace phase of this plan
// wires; nothing outside the module reads it before that. How many checks need a person right now,
// `0` until the first read answers.
export { useCerberusNeeds } from '@/modules/cerberus/context/CerberusContext';
