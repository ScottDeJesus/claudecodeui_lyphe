// How a retiring API lets the HTTP requests it already accepted finish before it exits.
//
// Without it the shutdown path's `process.exit` severed every request still running at SIGTERM.
// Behind Vite that surfaced as `[vite] http proxy error: … socket hang up` and a bare 500 to the
// browser, whose JSON parse then failed (`Error fetching projects: SyntaxError: Unexpected end of
// JSON input`).
//
// WEBSOCKETS ARE NOT CLOSED HERE, on purpose: they close at the exit, as they always have. A tab with
// a chat open re-subscribes ~120 ms after its socket closes (measured 2026-09-28 — the re-subscribe
// runs `probe()` → `reconnectNow()`, not the 3 s retry timer). Closed at the drain's start, that
// subscribe would reach the successor while this process still holds the keepalive hosts, before the
// takeover that re-adopts them, and read a live session as idle (D-11). Left open, those clients stay
// on the server that owns their runs until the moment it leaves.
import type { Server, ServerResponse } from 'node:http';

// How long requests already running get once shutdown begins. Three facts set it:
//  - the dev supervisor SIGKILLs a retiring child STOP_TIMEOUT_MS (10 s) after its SIGTERM
//    (deploy/dev-supervisor/child.mjs), and the teardown after the drain can itself take 5 s (a
//    plugin that ignores SIGTERM is force-killed only then, plugin-process.service.ts), so the drain
//    can never have more than ~4 s — this bound is that ceiling;
//  - the app's own polled reads run up to 2.5 s end to end under load (measured 2026-09-28: GET
//    /api/heal/summary p90 2.2 s, GET /api/projects max 2.5 s), longer while a successor boots beside
//    them;
//  - every millisecond of drain delays the successor's takeover, sent only once this process has
//    exited; the one takeover-dependent read the tabs poll waits for it (`server/index.ts` holds
//    GET /api/providers/sessions/running until the re-adoption). So the drain ends the moment the
//    last request finishes — the bound binds only a request slower than the app's own reads (a
//    search stream, an agent run), which is cut at the exit exactly as before and named in the
//    journal.
const HTTP_DRAIN_BOUND_MS = 4_000;

/**
 * Starts tracking `server`'s in-flight requests and returns the drain its shutdown path awaits.
 *
 * Consumer: `server/index.ts`, which arms it at build — before `listen`, so every request this
 * process ever accepts is one the drain knows about — and awaits the returned drain on SIGTERM/SIGINT
 * BEFORE tearing down plugins or browser sessions (a running request may still need them) and before
 * releasing keepalive ownership (the successor's takeover must wait for the exit, as it always has).
 *
 * The drain, once called (idempotent — a second signal gets the same promise):
 *  1. stops accepting: with `reusePort` the kernel would otherwise keep handing this exiting process
 *     new connections, which the successor's listener now takes instead;
 *  2. closes idle keep-alive sockets, and marks every answer still to be written `Connection: close`,
 *     so a finished request leaves no idle socket behind for a client to reuse at the moment of exit;
 *  3. resolves when the last in-flight request has closed, or at the bound — never rejects.
 */
export function armHttpDrain(server: Server): () => Promise<void> {
    // Response → "METHOD /path", the label the journal names a cut request by. The query string is
    // left off on purpose: some routes carry an auth token there.
    const inFlight = new Map<ServerResponse, string>();
    let drain: Promise<void> | null = null;
    // Set while the drain waits: every request that closes re-checks whether it was the last.
    let onRequestClosed: (() => void) | null = null;

    // Prepended, so it runs before express: a request that reaches an already-open keep-alive socket
    // mid-drain is still answered here (this process is whole until it exits), and its answer must be
    // marked before express has had the chance to write the headers.
    server.prependListener('request', (request, response) => {
        inFlight.set(response, `${request.method} ${(request.url ?? '/').split('?')[0]}`);
        if (drain !== null) response.shouldKeepAlive = false;
        // 'close' fires once per response: after it finished, or when its socket died first.
        response.once('close', () => {
            inFlight.delete(response);
            onRequestClosed?.();
        });
    });

    async function runDrain(): Promise<void> {
        const startedAt = Date.now();
        // Never awaited: its callback waits on every socket, the open websockets included.
        server.close();
        for (const response of inFlight.keys()) {
            if (!response.headersSent) response.shouldKeepAlive = false;
        }
        server.closeIdleConnections();

        let finished = 0;
        const settled = await new Promise<boolean>((resolve) => {
            const bound = setTimeout(() => resolve(false), HTTP_DRAIN_BOUND_MS);
            const resolveIfDrained = () => {
                if (inFlight.size > 0) return;
                clearTimeout(bound);
                resolve(true);
            };
            onRequestClosed = () => {
                finished += 1;
                // A streamed answer whose keep-alive header was already sent leaves its socket idle
                // when it finishes; reaped here rather than left open until the exit.
                server.closeIdleConnections();
                resolveIfDrained();
            };
            resolveIfDrained();
        });
        onRequestClosed = null;

        // One line only when there was something to wait for: an idle retirement says nothing. The pid
        // is in the text because the warning reaches the journal through the supervisor's stderr
        // relay, which files it under the supervisor's own pid.
        if (!settled) {
            const cut = [...inFlight.values()].join(', ');
            console.warn(`[shutdown] pid ${process.pid}: drain bound ${HTTP_DRAIN_BOUND_MS} ms reached — ${finished} finished, cutting ${inFlight.size}: ${cut}`);
        } else if (finished > 0) {
            console.log(`[shutdown] pid ${process.pid}: drained ${finished} in-flight request(s) in ${Date.now() - startedAt} ms`);
        }
    }

    return () => {
        drain ??= runDrain();
        return drain;
    };
}
