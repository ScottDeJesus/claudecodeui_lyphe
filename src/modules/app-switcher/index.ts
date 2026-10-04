// The switcher's four doors, and every one is a mount. The project-workspace shell wraps its tree in
// the provider, renders the layer over the main region and the FAB beside the command palette, and
// hands the dock to the sidebar header's `leading` slot.
//
// EXACTLY TWO THINGS ELSE LEAVE, and each is one of the two shapes a decision can take across a
// module boundary. `useCurrentApplication` is an ANSWER — the application in front, or null — and
// `useSwitcherActions` is a set of VERBS — the five acts the radial and the palette draw. Both are
// computed in here from the state hook, so which pane is in front and which row is this app are
// still decided in one place, and a caller can ask what is up or do something about it without ever
// holding the panes to work either out.
//
// NOTHING ELSE LEAVES THIS MODULE — not the hook the doors read their state with, not the registry
// hook, not the url and storage utils, not the drawer or the pane. A third export is how a rule that
// must be decided in one place starts being read in two.
export { AppSwitcherProvider } from '@/modules/app-switcher/context/AppSwitcherContext';
export { AppSwitcherDock } from '@/modules/app-switcher/AppSwitcherDock';
export { AppSwitcherFab } from '@/modules/app-switcher/AppSwitcherFab';
export { AppSwitcherLayer } from '@/modules/app-switcher/AppSwitcherLayer';
export { useCurrentApplication } from '@/modules/app-switcher/hooks/useCurrentApplication';
export { useSwitcherActions } from '@/modules/app-switcher/hooks/useSwitcherActions';
