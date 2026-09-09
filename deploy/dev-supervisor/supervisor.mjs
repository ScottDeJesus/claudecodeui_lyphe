// The dev API's supervisor: it boots the edited server BESIDE the running one and retires the old
// one only once the new one is listening, so a save under server/ never leaves :3011 unanswered.
// The watcher this replaces killed first and booted after, which made every edit a gap and every
// broken edit an outage. Mechanism, log lines and failure table: ./README.md.
import path from 'node:path';
import process from 'node:process';

import { BOOT_TIMEOUT_MS, spawnServer } from './child.mjs';
import { watchServerDir } from './watch.mjs';

const REPO = path.resolve(import.meta.dirname, '../..');
const WATCH_DIR = path.join(REPO, 'server');

const children = new Set();  // every child spawned and not yet exited, whatever its role
let serving = null;  // the child that answered READY and holds the port
let pending = null;  // a child still booting; nothing is listening on its behalf yet
let queued = false;  // an edit arrived while a boot or a retirement was in flight
let busy = false;    // a cycle owns the children right now
let stopping = false;

const log = (message) => console.log(`[supervisor] ${message}`);

/** Node's own record of how a child ended — no second copy of that fact is kept here. */
const exitReason = (child) => child.signalCode ?? String(child.exitCode);

function reportFailedBoot(attempt, failure) {
    const kept = serving !== null;
    if (failure.timedOut) {
        log(`boot timed out after ${BOOT_TIMEOUT_MS / 1000} s — ${kept ? 'previous server kept' : 'no previous server'}`);
        return;
    }
    const detail = attempt.firstErrorLine() ?? failure.message;
    if (kept) log(`boot failed — previous server kept: ${detail}`);
    else log(`boot failed — no previous server: ${detail}`);
}

/** Reports a serving child that dies on its own. Deliberately does NOT boot a replacement. */
function watchForCrash(attempt, pid) {
    attempt.child.once('exit', () => {
        // A retirement, or our own shutdown: both already have their line.
        if (stopping || serving !== attempt) return;
        serving = null;
        // No restart here on purpose: a server that crashes after READY crashes again on the same
        // code, and a crash loop is exactly what the watchdog's three-heal rule exists to catch.
        log(`server pid ${pid} exited (${exitReason(attempt.child)}) — waiting for the next change`);
    });
}

/**
 * Releases a child that booted beside a predecessor and has been holding its sole-server duties.
 * Every caller must have established that the predecessor's process is GONE — while it lived its
 * keepalive hosts were live, and the successor's re-adoption ends those sessions with SIGHUP
 * (host.js:198-204). This is the ONE place the takeover is sent, so "exactly once per handover
 * child" is a property of the call sites and not of a flag.
 */
function handOver(next, pid) {
    next.child.send({ type: 'takeover' }, (error) => {
        // Claimed only once the word has actually landed on a child that is still the serving one.
        // A successor can die inside the retirement window — up to STOP_TIMEOUT_MS of it, while a
        // predecessor refuses SIGTERM — and its own exit handler has already emptied `serving` by
        // then, so the state needs no repair. The LINE would be the whole lie: a journal claiming a
        // completed handover to a dead pid, and a verification grep finding that success sitting
        // beside an unbound port.
        if (error) console.error(`[supervisor] takeover to pid ${pid} failed: ${error.message}`);
        else if (serving === next) log(`handover complete — serving pid ${pid}`);
    });
}

async function retire(previous, next, pid) {
    const oldPid = previous.child.pid;
    // Awaited to its exit, never merely signalled: see handOver above for what a live predecessor
    // costs the sessions of a successor that re-adopts too early.
    await previous.stop();
    log(`retired pid ${oldPid} (${exitReason(previous.child)})`);
    handOver(next, pid);
}

async function bootOnce() {
    // Read once, at spawn: this is what the child was TOLD, and the child holds its duties on that
    // word alone. The serving slot can empty underneath a boot (see the crash path below).
    const deferred = serving !== null;
    const attempt = spawnServer({ repo: REPO, handover: deferred });
    children.add(attempt);
    attempt.child.once('exit', () => children.delete(attempt));
    pending = attempt;
    log(`boot: pid ${attempt.child.pid}`);

    let pid = null;
    let failure = null;
    try { pid = await attempt.ready; } catch (error) { failure = error; }

    // Superseded while it booted: onChange already signalled it and cleared the slot, so all that
    // is left is reaping it — which is what keeps exactly one child here between bursts.
    if (pending !== attempt) { await attempt.stop(); return; }
    pending = null;

    if (failure) {
        // Reported BEFORE the stop, never after: a child wedged enough to need the SIGKILL
        // escalation holds stop() for its full 10 s, and the line explaining a stalled restart
        // must not queue behind the stall it explains.
        if (!stopping) reportFailedBoot(attempt, failure);
        // The old server is never touched on this path; a hung boot is, or it would linger forever.
        await attempt.stop();
        return;
    }

    const previous = serving;
    serving = attempt;
    watchForCrash(attempt, pid);
    if (previous) {
        log(`handover: pid ${pid} ready — retiring pid ${previous.child.pid}`);
        await retire(previous, attempt, pid);
        return;
    }
    if (deferred) {
        // The predecessor died on its own while this child booted; its own exit line is already in
        // the log above, and `serving` emptied with it. The duties are owed the moment that process
        // is gone — and it is gone. Without this the API would serve while every keepalive host it
        // was spawned to inherit stayed unadopted, with nothing left alive to send the word.
        handOver(attempt, pid);
        return;
    }
    // A first boot has no predecessor to wait for, so it ran its duties before it listened.
    log(`serving pid ${pid}`);
}

async function cycle() {
    if (busy) return;
    busy = true;
    try {
        do {
            queued = false;
            try {
                await bootOnce();
            } catch (error) {
                // Defect insurance: this process must outlive anything one boot can do to it — and
                // must not leave its child behind. A leaked one still binds the port with
                // reusePort, and the kernel would split live requests between it and its successor.
                if (pending) { void pending.stop(); pending = null; }
                log(`boot aborted: ${error.message}`);
            }
        } while (queued && !stopping);
    } finally {
        busy = false;
    }
}

function onChange(relativePath) {
    if (stopping) return;
    log(`change: ${relativePath}`);

    if (pending) {
        // The booting child already loaded the previous version of this file, so there is nothing
        // to salvage; leaving it alive would give this process two children racing for one port.
        log('change during boot — restarting boot');
        const superseded = pending;
        pending = null;
        queued = true;
        void superseded.stop();
        return;
    }
    // A retirement is finishing; the running cycle picks the queued edit up when it lands.
    if (busy) { queued = true; return; }
    void cycle();
}

async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    log(`stopping (${signal})`);
    closeWatcher();
    // Every live child, not just the two the state machine names: one may be mid-retirement and
    // reachable only from retire()'s own frame. Awaited, never fired and forgotten — exiting first
    // would orphan a server on the port with its own SIGKILL timer dead alongside this process.
    await Promise.all([...children].map((child) => child.stop()));
    process.exit(0);
}

log(`watching ${WATCH_DIR}`);
const closeWatcher = watchServerDir(WATCH_DIR, onChange);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { void shutdown(signal); });
void cycle();
