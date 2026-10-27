// The naming pass that gives a chat a name a person can say, riding every run's end. `server/index.ts` builds it,
// starts it after `listen` and stops it on shutdown; the rule, the transcript reader and the Haiku call stay inside.
export { createChatNamer } from './chat-namer.service.js';
