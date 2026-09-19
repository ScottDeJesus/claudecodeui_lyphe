// ---------------------------
//----------------- APPLICATION SWITCHER CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the application registry: the shapes the drawer reads off a wire, in
// one home of their own.
//
// It mirrors `server/shared/app-types.ts` field for field, and that file is the one place to look
// when a shape here seems wrong. The two edit TOGETHER: a field renamed on one side and not the
// other is a response the drawer quietly stops reading.
//
// It imports NOTHING from `server/`: the client tsconfig does not compile server code, and an
// `import type` across that boundary is a bundle that cannot build.
//
// It is a SIBLING of `src/shared/types.ts` rather than an addition to it, for the reason the two
// `kanban-types.ts` files are siblings of their own `types.ts`: that file is 2078 lines and the
// house ceiling for a module is 300. `src/shared/` already carries `authToken.ts`, `constants.ts`,
// `uiPreferences.ts` and more beside `types.ts`, so this is the existing convention.

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
