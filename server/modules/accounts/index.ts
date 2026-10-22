// The accounts module's barrel: its composition root and the reads the rest of the server has. The
// slot store, its types and every path it computes stay inside the module — a caller reaches the
// switcher over the router this barrel hands it, never by importing a service. `liveAccountEmail` is
// the live login's email, read by the Claude auth provider's "signed in as" line. `launchCredential`
// is the account in use and its sign-in token, read by `claude-launch-account.ts` (the providers
// module) at a chat CLI's spawn. `chosenAccount` is the house's choice, read by the Claude runtime's
// join path so a message can tell whether the account changed under a running process. Neither read
// is ever cached here. `notePacerReading` files one window reading with the pacer's door: the meter's
// own poll (`usage.service.ts`, source "meter") and a chat's rate-limit event
// (`claude-chat-readings.ts`, source "chat").

export { createAccountsModule } from './accounts.module.js';
export { launchCredential } from './account-door.js';
export { identity as liveAccountEmail } from './account-store.service.js';
export { chosenAccount } from './chosen-account.js';
export { note as notePacerReading } from './pacer-door.js';
