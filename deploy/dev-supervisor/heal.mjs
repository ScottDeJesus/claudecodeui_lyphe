// How the supervisor heals its own child (./supervisor.mjs, rules in ./README.md): a serving child that dies, a boot that
// fails with nothing serving, and a serving child gone silent are all booted again — but only three times in a row on
// one code, because a server that dies three times without ever lasting a minute will die on it again, and feeding
// that loop would hide it. A settled save clears the count: new code earns new heals.

export const MAX_HEALS = 3;            // boots in a row with no stable server between them
export const STABLE_MS = 60_000;       // a server that served this long clears the count
export const RETRY_DELAY_MS = 5_000;   // before a boot that failed with nothing serving is tried again
export const SILENCE_MS = 45_000;      // three of the child's 15 s beats missed (server/supervised-boot.ts)

/** The heal budget: `next(servedMs)` answers this heal's number, 1 to MAX_HEALS, or null when they are spent. */
export function createHeals() {
    let spent = 0;
    return {
        next(servedMs) {
            if (servedMs >= STABLE_MS) spent = 0;
            if (spent >= MAX_HEALS) return null;
            spent += 1;
            return spent;
        },
        clear() { spent = 0; },
    };
}

/**
 * One deadline per child that beats. A child's first `{ type: 'alive' }` arms it, and every later message of any type
 * from that child sets it again; a child that never beats (an older build) is never judged. `onSilent(attempt)` fires
 * once the deadline passes; what to do with a silent child is the caller's.
 */
export function createSilenceWatch({ onSilent }) {
    const deadlines = new Map();  // child attempt → its pending timer
    const arm = (attempt) => {
        clearTimeout(deadlines.get(attempt));
        deadlines.set(attempt, setTimeout(() => {
            deadlines.delete(attempt);
            onSilent(attempt);
        }, SILENCE_MS));
    };
    return {
        heard(attempt, message) {
            if (deadlines.has(attempt) || message?.type === 'alive') arm(attempt);
        },
        drop(attempt) {
            clearTimeout(deadlines.get(attempt));
            deadlines.delete(attempt);
        },
        close() {
            for (const timer of deadlines.values()) clearTimeout(timer);
            deadlines.clear();
        },
    };
}
