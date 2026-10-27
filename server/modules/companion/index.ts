// createCompanionModule: used by the server entrypoint to mount Kaylee's authenticated router at
// `/api/companion` and to stop her conversations first on shutdown. The whole of the module's public surface.
export { createCompanionModule } from './companion.module.js';
