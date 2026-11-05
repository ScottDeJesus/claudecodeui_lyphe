//----------------- RESTART HOLD ------------
// What the API tells the dev supervisor about itself, in one home of its own: the module that keeps the
// picture and `server/supervised-boot.ts`, which carries it over the IPC channel, both name the shape,
// and neither owns the other. A SIBLING of `server/shared/types.ts` for the reason
// `claude-activity-types.ts` is one. Server-only — the supervisor (`deploy/dev-supervisor`) reads the same
// two fields as plain JSON and shares no code with this.

/**
 * One thing the server is busy with, as the dev supervisor is told it. A save under `server/` waits for
 * the server to hold none of these before it restarts the API (`deploy/dev-supervisor/README.md`).
 *
 * `why` is a plain sentence a person can read in the journal as it stands ("Kaylee is in a turn (account 1)").
 * `yields` is true for the one reason the supervisor may stop counting once a save has been held for its
 * ceiling: a chat run, which survives a handover on its keepalive host. Kaylee's turn, his mic, her voice
 * and the quiet tail after his words never yield — a restart cuts those.
 */
export type RestartHoldReason = {
  why: string;
  yields: boolean;
};
