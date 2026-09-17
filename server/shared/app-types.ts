// ---------------------------
//----------------- APPLICATION SWITCHER CONTRACTS ------------
// The two shapes the application registry puts on a wire, in one home of their own.
//
// It is a SIBLING of `server/shared/types.ts` rather than an addition to it, for the reason every
// other sibling here exists: that file is 1672 lines, the house ceiling for a module is 300, and
// the Kanban board established the pattern (`server/shared/kanban-types.ts` beside ten more).
//
// The client mirror is `src/shared/app-types.ts`, field for field. A change here without the same
// change there is a response the drawer cannot read, so the two are edited together, always.
//
// `server/shared/types.ts` is not opened by anything in this lane.

/** One row of the application registry. The shape a builder appends by hand. */
export type AppEntry = { id: string; name: string; url: string };

/** What GET /api/apps answers. `selfPorts` is how the client knows which row is this app. */
export type AppRegistryResponse = { apps: AppEntry[]; selfPorts: number[] };
