// One API child of the dev supervisor, spawned byte for byte the way the watcher this package
// replaces spawned it, plus the boot bits and the IPC channel the handover rides on. The child's
// half of that contract lives in server/supervised-boot.ts.
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// A healthy boot is ~1-4 s here; this bound only has to outlast the slowest honest one, because
// every second of it is a second the supervisor holds an edit back from the port.
export const BOOT_TIMEOUT_MS = 30_000;

// How long a retiring server may take to close its sockets before it is killed outright.
export const STOP_TIMEOUT_MS = 10_000;

// `SyntaxError: ...`, `TypeError: ...` — the one line a human needs out of a failed boot, which
// otherwise opens with a loader banner or a bare stack frame.
const ERROR_LINE = /\b[A-Za-z]*Error\b/;

// A dying child's reason reaches us through a PIPE, and the pipe need not be drained by the moment
// the process is reaped: with more than a buffer's worth of output the last chunks — the ones
// carrying the error — arrive after 'exit'. So a boot's failure waits for whichever lands second,
// the exit or the end of stderr, and `firstErrorLine()` is whole when the supervisor prints it.
// The wait is BOUNDED because a grandchild that inherited this pipe (a plugin server, a session
// host) can hold it open long after the API is gone, and a boot verdict must never hang on one.
const STDERR_DRAIN_MS = 250;

/**
 * Spawns one server process.
 *
 * @param {{ repo: string, handover: boolean }} options `handover` iff a serving predecessor still
 *   holds the port, which makes the child defer its sole-server duties until the takeover message.
 * @returns {{ child: import('node:child_process').ChildProcess, ready: Promise<number>,
 *   firstErrorLine: () => string|null, stop: () => Promise<void> }}
 */
export function spawnServer({ repo, handover }) {
    const tsxDist = path.join(repo, 'node_modules', 'tsx', 'dist');
    const env = {
        ...process.env,
        CLOUDCLI_SUPERVISED: '1',
        TSX_TSCONFIG_PATH: path.join(repo, 'server', 'tsconfig.json'),
    };
    // Deleted, not merely left unset: a stray bit exported into the unit's environment would park
    // every first boot forever, waiting on a takeover that no predecessor exists to trigger.
    if (handover) env.CLOUDCLI_HANDOVER = '1'; else delete env.CLOUDCLI_HANDOVER;

    // The loader pair, never the tsx CLI: through the CLI the pid held here would be tsx's, the IPC
    // channel would be tsx's, and SIGTERM would reach the server through one more relay.
    const child = spawn(process.execPath, [
        '--require', path.join(tsxDist, 'preflight.cjs'),
        '--import', pathToFileURL(path.join(tsxDist, 'loader.mjs')).href,
        'server/index.ts',
    ], { cwd: repo, env, stdio: ['ignore', 'inherit', 'pipe', 'ipc'] });

    let exited = false;
    let settled = false;
    let stopping = null;
    let firstError = null;
    let firstLine = null;

    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

    const timer = setTimeout(() => {
        const error = new Error(`boot timed out after ${BOOT_TIMEOUT_MS} ms`);
        error.timedOut = true;
        fail(error);
    }, BOOT_TIMEOUT_MS);

    function settle() {
        settled = true;
        clearTimeout(timer);
        child.off('message', onMessage);
    }

    function fail(error) {
        if (settled) return;
        settle();
        rejectReady(error);
    }

    // Readiness is the listen callback's own word and nothing else: with two servers sharing the
    // port, an HTTP probe cannot say WHICH of them answered.
    function onMessage(message) {
        if (settled || message?.type !== 'ready') return;
        settle();
        resolveReady(message.pid ?? child.pid);
    }
    child.on('message', onMessage);

    let stderrEnded = false;
    let howItDied = null;
    let drainTimer = null;

    // Called from both sides of the race; whichever arrives second is the one that settles.
    function failExited() {
        if (drainTimer) { clearTimeout(drainTimer); drainTimer = null; }
        fail(new Error(`exited before ready (${howItDied})`));
    }

    child.on('exit', (code, signal) => {
        exited = true;
        howItDied = signal ?? code;
        if (settled) return;
        if (stderrEnded) failExited();
        else drainTimer = setTimeout(failExited, STDERR_DRAIN_MS);
    });

    // A ChildProcess 'error' with no listener is thrown into the supervisor. Before READY it is the
    // boot's verdict; after READY there is nobody left to reject, so it is reported and swallowed.
    child.on('error', (error) => {
        if (settled) console.error(`[supervisor] child pid ${child.pid}: ${error.message}`);
        else fail(error);
    });

    function consume(rawLine) {
        const line = rawLine.trimEnd();
        if (!line.trim()) return;
        if (firstLine === null) firstLine = line;
        if (firstError === null && ERROR_LINE.test(line)) firstError = line;
    }

    // stderr is piped ONLY so a failed boot can be explained in one line; it is relayed unedited so
    // the journal still holds everything the server said. stdout stays inherited, which keeps the
    // child's own pid on its journal entries.
    let carry = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
        if (settled) return;
        carry += chunk;
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) consume(line);
    });
    // A boot that dies mid-line still owes us its reason.
    child.stderr.on('end', () => {
        stderrEnded = true;
        if (!settled && carry) consume(carry);
        // The exit got here first and has been waiting on this: every byte is in, so it may speak.
        if (!settled && howItDied !== null) failExited();
    });

    function stop() {
        if (stopping) return stopping;
        stopping = new Promise((resolve) => {
            if (exited) return resolve();
            const kill = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
            kill.unref();
            child.once('exit', () => { clearTimeout(kill); resolve(); });
            child.kill('SIGTERM');
        });
        return stopping;
    }

    return {
        child,
        ready,
        // The Error line if the boot produced one, else whatever it said first.
        firstErrorLine: () => firstError ?? firstLine,
        stop,
    };
}
