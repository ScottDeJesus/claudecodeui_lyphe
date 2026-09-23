// createCliVersionModule: used by the server entrypoint to mount the authenticated CLI-version report at `/api/cli-version`.
export { createCliVersionModule } from './cli-version.module.js';
// readInstalledCliVersion: the same cached reading of the installed binary, for the chat runtime's
// own use of it — the launch profile that retires a process older than the binary on disk
// (claude-runtime.provider.js). One reading, one cache: see cli-version.service.ts.
export { readInstalledCliVersion } from './cli-version.service.js';
// observeInstalledCliVersionChanges: the transition of that reading, for a consumer that acts on an
// INSTALL rather than on a message — the keepalive's sweep over idle hosts (session-host's
// idle-version-sweep.ts). consumer: session-host/index.ts
export { observeInstalledCliVersionChanges } from './cli-version-change.js';
export type { InstalledCliVersionChange } from './cli-version-change.js';
