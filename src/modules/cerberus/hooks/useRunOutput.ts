import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { CerberusRunLine, CerberusRunView } from '@/shared/cerberus-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/** The longest a finished run's replay takes, whatever the run took: a long run's pace is squeezed to fit. */
const REPLAY_CAP_S = 10;

/**
 * The least gap between two reveals of a replay. Lines come due together far oftener than the screen can
 * show them (a 5,000-line run squeezed into 10 s is one every 2 ms), so each tick reveals every line whose
 * moment has passed, and the replay costs at most this many renders a second, however long the run.
 */
const REPLAY_STEP_MS = 40;

/** What one run's output holds between reads and frames, for the run it names. */
type OutputState = {
  runId: string;
  /** The run as center last answered it; null until a read answers. */
  run: CerberusRunView | null;
  /** The latest read did not answer, and no read has since. */
  failed: boolean;
  /** Every line known so far, by `n`, from the reads and the frames. */
  lines: CerberusRunLine[];
  /** While a finished run is replaying: how many of `lines` are shown so far. Null when all are. */
  revealed: number | null;
};

const blank = (runId: string): OutputState => ({ runId, run: null, failed: false, lines: [], revealed: null });

/** True when a body is a run: the fields the output reads are there. */
function isRun(body: unknown): body is CerberusRunView {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as { id?: unknown; name?: unknown; cmd?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.cmd === 'string';
}

/** The lines held plus the incoming ones it did not have, in order of `n`. A line arrives by a read and by a frame, and is kept once. */
function mergeLines(held: CerberusRunLine[], incoming: CerberusRunLine[]): CerberusRunLine[] {
  const byNumber = new Map(held.map((line) => [line.n, line]));
  const before = byNumber.size;
  for (const line of incoming) if (!byNumber.has(line.n)) byNumber.set(line.n, line);
  return byNumber.size === before ? held : [...byNumber.values()].sort((a, b) => a.n - b.n);
}

/**
 * ONE RUN'S OUTPUT, read and kept live: the run as `GET /api/cerberus/runs/:id` answers it, and its
 * lines.
 *
 * THE LINES come from two roads that meet by `n`. The read brings every line the run holds; each
 * `cerberus_run_output` frame for this run brings the ones just stored, and a line a frame and the read
 * both carry is kept once. A frame is a picture, so it is appended as it lands; the run itself (its
 * result, its exit) is only ever what a read said, and the read is made again when a `cerberus_changed`
 * hint names the run's check, and on a reconnect.
 *
 * A RUN THAT HAS ALREADY ENDED, when it is first read, replays: each line appears at its own `t`, the
 * pace it arrived at, and the whole replay is squeezed to 10 s when the run took longer. A run read while
 * it is still going shows what it has at once and takes the rest as it comes, and a later read of any run
 * never replays: the lines it brings are shown as they are. `replaying` is true until the last line is
 * shown, so the card can hold back whatever belongs after them.
 *
 * `run` is null until the first read answers, and `failed` says the read did not (a refusal, this app's own
 * network): `refresh` reads it again. Used by `FixOutput`, keyed by the run, so another run starts blank.
 */
export function useRunOutput(runId: string): {
  run: CerberusRunView | null;
  lines: CerberusRunLine[];
  replaying: boolean;
  failed: boolean;
  refresh: () => void;
} {
  const { subscribe } = useWebSocket();

  // Everything the card draws, for the run it was last given. Essential: the lines and the run arrive by
  // frames and reads at no fixed moment, and `revealed` is the replay's own progress. It carries its run's
  // id, so the answer for a run the card has left is never drawn under the one it now shows.
  const [state, setState] = useState<OutputState>(() => blank(runId));

  // The effect's own read, handed out so Try again can start one. A ref, since the read lives in the effect.
  const readRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    // Which read this is: only the newest one's answer is applied.
    let newestRead = 0;
    // Whether the replay has been decided: it is decided once, by the first read that answers.
    let decided = false;
    // `<node>/<check key>`, as the hint names it, once a read has said which check the run is on.
    let hintedCheck: string | null = null;
    const timers: number[] = [];

    const update = (change: (held: OutputState) => OutputState) => {
      if (alive) setState((held) => change(held.runId === runId ? held : blank(runId)));
    };

    /**
     * Reveals the lines at their own offsets, squeezed to REPLAY_CAP_S. One timer at a time: each tick shows
     * every line whose moment has passed (the leading ones, in order) and sets the next for the following
     * line, no sooner than REPLAY_STEP_MS, so a long run is a few hundred renders and not one per line.
     */
    const replay = (lines: CerberusRunLine[]) => {
      const longest = Math.max(...lines.map((line) => line.t));
      const pace = longest > REPLAY_CAP_S ? REPLAY_CAP_S / longest : 1;
      const dueMs = lines.map((line) => Math.max(0, line.t * pace * 1000));
      const startedAt = Date.now();
      const tick = () => {
        const elapsed = Date.now() - startedAt;
        let shown = 0;
        while (shown < dueMs.length && dueMs[shown] <= elapsed) shown += 1;
        update((held) => (held.revealed === null ? held : { ...held, revealed: shown >= held.lines.length ? null : Math.max(held.revealed, shown) }));
        if (shown < dueMs.length) timers.push(window.setTimeout(tick, Math.max(REPLAY_STEP_MS, dueMs[shown] - elapsed)));
      };
      tick();
    };

    const read = async () => {
      const ticket = ++newestRead;
      let answer: CerberusRunView | null = null;
      try {
        const response = await api.cerberus.run(runId);
        if (response.ok) {
          const body: unknown = await response.json();
          if (isRun(body)) answer = body;
        }
      } catch {
        // This app's own network, or a body that is not JSON: the same "did not answer" a refusal is.
      }
      if (!alive || ticket !== newestRead) return;
      if (answer === null) {
        update((held) => ({ ...held, failed: true }));
        return;
      }
      hintedCheck = `${answer.node}/${answer.check}`;
      const brought = answer.lines ?? [];
      const replaying = !decided && answer.result !== null && brought.length > 0;
      decided = true;
      update((held) => ({
        ...held,
        run: answer,
        failed: false,
        lines: mergeLines(held.lines, brought),
        revealed: replaying ? 0 : held.revealed,
      }));
      if (replaying) replay(brought);
    };
    readRef.current = read;

    // Subscribed BEFORE the first read, as the other readers are: a frame that lands between the two is kept.
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'cerberus_run_output') {
        if (event.runId === runId && Array.isArray(event.lines)) {
          const incoming = event.lines as CerberusRunLine[];
          update((held) => ({ ...held, lines: mergeLines(held.lines, incoming) }));
        }
      } else if (event.kind === 'cerberus_changed') {
        if (hintedCheck !== null && Array.isArray(event.checks) && event.checks.includes(hintedCheck)) void read();
      } else if (event.kind === 'websocket_reconnected') {
        void read();
      }
    });
    void read();

    return () => {
      alive = false;
      unsubscribe();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [runId, subscribe]);

  const refresh = useCallback(() => {
    void readRef.current();
  }, []);

  const current = state.runId === runId ? state : blank(runId);
  return {
    run: current.run,
    lines: current.revealed === null ? current.lines : current.lines.slice(0, current.revealed),
    replaying: current.revealed !== null,
    failed: current.failed,
    refresh,
  };
}
