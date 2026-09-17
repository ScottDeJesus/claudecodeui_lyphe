// ---------------------------
//----------------- APPLICATION SWITCHER CONTRACTS (CLIENT MIRROR) ------------
// The client's view of the application registry: the two shapes the drawer reads off a wire, in
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

/** One row of the application registry. The shape a builder appends by hand. */
export type AppEntry = { id: string; name: string; url: string };

/** What GET /api/apps answers. `selfPorts` is how the client knows which row is this app. */
export type AppRegistryResponse = { apps: AppEntry[]; selfPorts: number[] };
