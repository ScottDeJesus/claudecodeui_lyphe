// The chat commands' shared ground: what a chat's own shell commands (`toolset`, `notes`, `followups`) need from
// the server — the credential each chat carries, the guard that checks it, the account a chat acts
// for, and the link that puts a command on the box's PATH.

// chatCredential: used by the toolsets module's launch hook to put each Claude chat's credential in
// its CLI's environment.
export { chatCredential } from './chat-commands.credential.js';

// chatCredentialGuard, chatAppSessionOf: used by the toolsets, notes and followups modules, as the first
// middleware of their command routers and the read of who passed it.
export { chatAppSessionOf, chatCredentialGuard } from './chat-commands.guard.js';

// accountOfChat: used by the notes and followups modules' command doors, to learn whose rows a chat may reach.
export { accountOfChat } from './chat-commands.account.js';

// ensureChatCommandLink: used by the toolsets, notes and followups modules at creation, one call per command.
export { ensureChatCommandLink } from './chat-commands.link.js';
