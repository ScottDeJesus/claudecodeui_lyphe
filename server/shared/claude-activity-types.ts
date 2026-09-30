//----------------- CLAUDE ACTIVITY ------------
// What the box answers to "is any Claude work in flight?", in one home of its own: the module that
// reads it and the one that gates an install on it both name the shape, and neither owns the other.
//
// A SIBLING of `server/shared/types.ts` for the reason `claude-update-types.ts` is one: that file is
// past two thousand lines and the house ceiling for a module is 300. Server-only — no client mirror.

/**
 * The answer to "is any Claude work in flight on this machine?".
 *
 * `busy` is true exactly when `reasons` is not empty, and every reason is a plain sentence a person can
 * read as it stands ("2 Claude conversations are working"). A leg that could not be READ is itself a
 * reason — the answer fails closed: an unknown is never reported as idle. Built by
 * `readClaudeActivity`; read by the Claude updates module to decide whether an install may start.
 */
export type ClaudeActivity = {
  busy: boolean;
  reasons: string[];
};
