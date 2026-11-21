// createCodeModeModule: used by the server entrypoint, once at boot, to register Code Mode's launch and
// servers-changed hooks with the Claude runtime. The whole of the module's public surface.
export { createCodeModeModule } from './code-mode.module.js';
