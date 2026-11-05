// What the supervisor makes of a serving child's restart-hold reports: a save under server/ waits for the
// serving API to say it is quiet before it restarts it, so Kaylee's turn, his press, her voice and his last
// words are never cut by a builder's edit. The child's half is server/modules/restart-hold; the messages and the
// rules are in ./README.md.

// Once a save has been held this long, reasons the child marks `yields` (a chat run, which survives a handover
// on its keepalive host) stop counting. Kaylee's turn, his press, her voice and the quiet tail never yield.
// Measured 2026-11-04 over the last day's journal: chat runs alone would have held 11 of 23 saves past it, the
// longest 128 minutes (`.verify/restart-hold-waits.mjs`).
export const CEILING_MS = 30 * 60_000;

// A child's reasons are free text on their way into this process's own journal: bounded, and line breaks
// flattened, so that no reason can ever write a second, forged `[supervisor]` line beneath the one that carried it.
const MAX_REASONS = 20;
const MAX_REASON_CHARS = 120;

/**
 * The reasons in a child's `busy` or `quiet` message, or null for any other shape. `quiet` is an empty list;
 * a `busy` that names nothing, or names something that is not `{ why: string, yields: boolean }`, is not this
 * protocol and is ignored whole rather than read as quiet.
 */
export function parseHoldReport(message) {
    if (message?.type === 'quiet') return [];
    if (message?.type !== 'busy' || !Array.isArray(message.reasons)) return null;
    const reasons = message.reasons
        .filter((reason) => typeof reason?.why === 'string' && typeof reason.yields === 'boolean')
        .slice(0, MAX_REASONS)
        .map((reason) => ({ why: reason.why.replace(/[\r\n]+/g, ' ').slice(0, MAX_REASON_CHARS), yields: reason.yields }));
    return reasons.length > 0 ? reasons : null;
}

/**
 * The reasons that still hold a save that has waited `heldMs`. `undefined` is a child that never reported (an older
 * build): it counts as quiet, which is how a restart behaved before the hold existed. `null` is no child serving at all.
 */
export function blockersOf(reasons, heldMs) {
    if (reasons === undefined || reasons === null) return [];
    return reasons.filter((reason) => !(reason.yields && heldMs >= CEILING_MS));
}

/** Milliseconds until a reason now holding stops counting, or null when none will. */
function msUntilCeiling(reasons, heldMs) {
    const waitingOnACeiling = blockersOf(reasons, heldMs).some((reason) => reason.yields);
    return waitingOnACeiling ? CEILING_MS - heldMs : null;
}

/** The reasons as one journal phrase. */
export function describe(reasons) {
    return reasons.map((reason) => reason.why).join('; ');
}

/**
 * The settled saves waiting for the serving API to be quiet. Every save made while they wait joins the one wait, so
 * a single cycle carries every change since the last.
 *
 * `add()` is a save that settled; `ask()` is "can they go now?", asked on a save, on every report from the serving child,
 * at the end of every cycle and when the serving child dies — never on a clock. The one timer here is set for the one
 * moment the answer changes without anyone reporting: a chat run's ceiling.
 *
 * `carry()` is a boot starting: it loads the code on disk, which already holds every save settled so far, so those
 * wait no more (a reboot request's boot is how a held save is carried without being released). `putBack()` is a boot
 * made for the saves that found the server busy again at its READY and was stopped: the saves wait as they did.
 *
 * - `readReasons()` is the serving child's last report (`null`: none serving; `undefined`: it never reported — quiet).
 * - `canRelease()` is false while a cycle owns the children; it asks again when it ends.
 * - `release({ since, count })` starts the cycle that carries the saves; `since` is when the first of them settled.
 */
export function createSaveHold({ log, readReasons, canRelease, release }) {
    const saved = { count: 0, since: null, announced: false, ceilingNoted: false, timer: null };
    const plural = (count) => `${count} held save${count === 1 ? '' : 's'}`;

    function forget() {
        clearTimeout(saved.timer);
        Object.assign(saved, { count: 0, since: null, announced: false, ceilingNoted: false, timer: null });
    }

    function ask() {
        if (!canRelease() || saved.count === 0) return;
        clearTimeout(saved.timer);
        saved.timer = null;
        const held = Date.now() - saved.since;
        const reasons = readReasons();
        const blockers = blockersOf(reasons, held);
        if (blockers.length === 0) {
            // A server that died is not "quiet": the save goes because nothing is left to protect.
            if (saved.announced) log(`${reasons === null ? 'nothing is serving' : 'quiet'} — restarting for ${plural(saved.count)} after ${Math.round(held / 1000)} s`);
            const carried = { since: saved.since, count: saved.count };
            forget();
            release(carried);
            return;
        }
        if (!saved.announced) {
            saved.announced = true;
            log(`change held — waiting on: ${describe(blockers)}`);
        }
        const ceilingIn = msUntilCeiling(reasons, held);
        if (ceilingIn !== null) saved.timer = setTimeout(ask, ceilingIn);
        else if (!saved.ceilingNoted && held >= CEILING_MS && reasons.some((reason) => reason.yields)) {
            saved.ceilingNoted = true;
            log(`held ${CEILING_MS / 60_000} min — chat runs no longer hold the restart`);
        }
    }

    return {
        add() {
            saved.count += 1;
            saved.since ??= Date.now();
            ask();
        },
        ask,
        carry() {
            if (saved.count === 0) return;
            if (saved.announced) log(`this boot carries the ${plural(saved.count)}`);
            forget();
        },
        putBack({ since, count }) {
            saved.count += count;
            saved.since = Math.min(saved.since ?? since, since);
            // The supervisor's own line said what they wait on again.
            saved.announced = true;
        },
        close() { clearTimeout(saved.timer); },
    };
}
