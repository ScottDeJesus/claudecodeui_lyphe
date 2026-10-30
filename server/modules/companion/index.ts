// createCompanionModule: used by the server entrypoint to mount Kaylee's authenticated router at
// `/api/companion` and to stop her conversations first on shutdown. The whole of the module's public surface.
export { createCompanionModule } from './companion.module.js';
// CompanionHouse: used by the server entrypoint, which builds the house from the dispatcher, roadmap, dispatch-souls,
// Cerberus and heal instances it holds and hands it to `createCompanionModule` — the readers only a module instance has.
export type { CompanionHouse } from './house.js';
