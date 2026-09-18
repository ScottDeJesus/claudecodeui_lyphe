// The accounts module's barrel: its composition root and one read. The slot store, its types and
// every path it computes stay inside the module — a caller reaches the switcher over the router this
// barrel hands it, never by importing a service. The one read is `identity`, the live login's email:
// the usage-limit notices key what they have already said by it, because a limit belongs to an account.

export { createAccountsModule } from './accounts.module.js';
export { identity as liveAccountEmail } from './account-store.service.js';
