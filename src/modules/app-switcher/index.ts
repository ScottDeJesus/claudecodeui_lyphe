// The switcher's four doors, and every one is a mount. The project-workspace shell wraps its tree in
// the provider, renders the layer over the main region and the FAB beside the command palette, and
// hands the dock to the sidebar header's `leading` slot.
//
// NOTHING ELSE LEAVES THIS MODULE — not the hook the four read their state with, not the registry
// hook, not the url and storage utils, not the drawer or the pane. A second export is how a rule that
// must be decided in one place — which row is this app, which side a choice fills — starts being
// read in two.
export { AppSwitcherProvider } from '@/modules/app-switcher/context/AppSwitcherContext';
export { AppSwitcherDock } from '@/modules/app-switcher/AppSwitcherDock';
export { AppSwitcherFab } from '@/modules/app-switcher/AppSwitcherFab';
export { AppSwitcherLayer } from '@/modules/app-switcher/AppSwitcherLayer';
