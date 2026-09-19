// ---------------------------
//----------------- APPLICATION SWITCHER CONTRACTS ------------
// The shapes the application registry puts on a wire, in one home of their own.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the reason every
// other sibling here exists: that file is 1672 lines, the house ceiling for a module is 300, and
// the Kanban board established the pattern (`server/shared/kanban-types.ts` beside ten more).
//
// The client mirror is `src/shared/app-types.ts`, field for field. A change here without the same
// change there is a response the drawer cannot read, so the two are edited together, always.
//
// `server/shared/types.ts` is not opened by anything in this lane.

/**
 * One row of the application registry. The shape a builder appends by hand. `description` is the
 * operator's own line under the name; a row without one shows where it answers instead.
 */
export type AppEntry = { id: string; name: string; url: string; description?: string };

/**
 * A divider in the registry file: a line across the drawer's list, with a title that may be blank.
 * It sits among the app rows, in the file's order — `{ "id": "divider-x1y2", "divider": "Work" }`.
 */
export type DividerEntry = { id: string; divider: string };

/** The drawer's list in file order: an app, by id into `apps`, or a divider with its title. */
export type RegistryRow = { kind: 'app'; id: string } | { kind: 'divider'; id: string; title: string };

/**
 * What GET /api/apps answers. `apps` is the applications alone, in file order; `rows` is the whole
 * list as the drawer draws it, dividers included. `selfPorts` is how the client knows which row is
 * this app; `icons` holds each app's own tab icon as a data URL, by app id — an app that publishes
 * none is absent.
 */
export type AppRegistryResponse = {
  apps: AppEntry[];
  rows: RegistryRow[];
  selfPorts: number[];
  icons: Record<string, string>;
};
