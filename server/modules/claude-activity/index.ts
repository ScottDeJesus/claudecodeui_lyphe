// readClaudeActivity: used by the server entrypoint, which hands it to the Claude updates module as
// the one question an automatic install asks before it starts — is any Claude work in flight?
export { readClaudeActivity } from './claude-activity.service.js';
