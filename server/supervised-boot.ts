// The boot protocol between the dev supervisor and the API child it spawns.
//
// Both environment bits count ONLY alongside a live IPC channel. A bit left exported in a shell —
// or inherited by a by-hand `npm run server:dev` — must never make a plain boot share :3011 with
// the unit's child, nor park it waiting for a takeover that nobody can send.
import process from 'node:process';

// The supervisor's own stop bound is SIGKILL at 10 s, so silence past this is its defect, and this
// warning is the only breadcrumb a parked-looking session leaves behind. The override is a probe
// knob, NOT a third member of the supervisor<->child contract: nothing in production ever sets it.
const TAKEOVER_WARN_MS = Number(process.env.CLOUDCLI_TAKEOVER_WARN_MS) || 30_000;

export const supervised =
    process.env.CLOUDCLI_SUPERVISED === '1' && typeof process.send === 'function';

/** True only when a serving predecessor already held the port at spawn time. */
export const handover = supervised && process.env.CLOUDCLI_HANDOVER === '1';

/**
 * Tells the supervisor this process is listening. Listening IS readiness — the supervisor retires
 * the predecessor on this message, so nothing slower than the bind may gate it.
 *
 * Guarded on `process.connected`, NEVER on `process.send`: the method stays a function after the
 * channel closes, and the send then fails ASYNCHRONOUSLY as an unhandled 'error' on `process`
 * (ERR_IPC_CHANNEL_CLOSED — measured here: the child dies, exit 1), which no try/catch can hold.
 * A supervisor dying during this child's 2-4 s boot would then kill the child at its own listen
 * callback — the exact opposite of the still-serving stance `onTakeover` takes below. The callback
 * closes what is left: if the channel drops between the check and the send, the error lands there.
 */
export function signalReady(): void {
    if (!process.connected) return;
    process.send?.({ type: 'ready', pid: process.pid }, (error: Error | null) => {
        if (error) console.warn('[keepalive] supervisor left before READY was sent — serving anyway');
    });
}

/**
 * Defers the sole-server duties until the supervisor reports the predecessor gone.
 *
 * Only `takeover` may run them. Re-adopting while the previous server still holds its hosts is a
 * steal: re-attaching a live host ends the earlier run with SIGHUP (session-host/host.js:198-204,
 * spawner.ts:200-208). That is also why `disconnect` is log-only — under systemd the supervisor's
 * death is followed by SIGTERM to both children within milliseconds, and duties running in that
 * gap would end the predecessor's runs for nothing.
 */
export function onTakeover(duties: () => Promise<void>): void {
    let taken = false;

    // Named so it can be detached the moment it has done its one job: after the takeover there is
    // nothing left for a supervisor message to say, and a handler that can never act again should
    // not stay on the channel reading them.
    const onSupervisorMessage = (message: unknown) => {
        if (taken || (message as { type?: unknown } | null)?.type !== 'takeover') return;
        // Once, never twice: readoptKeepaliveSessions is not idempotent — a second pass
        // re-connects hosts it already owns and severs the sockets of the first pass.
        taken = true;
        process.off('message', onSupervisorMessage);
        console.log('[keepalive] taking over');
        void duties().catch((error: unknown) => {
            console.error('[keepalive] takeover duties failed:', error);
        });
    };
    process.on('message', onSupervisorMessage);

    process.on('disconnect', () => {
        if (taken) return;
        console.log('[keepalive] supervisor channel closed before takeover — staying deferred');
    });

    // Unref'd: a breadcrumb must never be the reason this process stays alive.
    setTimeout(() => {
        if (!taken) console.log(`[keepalive] no takeover after ${TAKEOVER_WARN_MS / 1000} s — still deferred`);
    }, TAKEOVER_WARN_MS).unref();
}
