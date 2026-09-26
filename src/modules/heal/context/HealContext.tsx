import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { HealScreenState, HealSummary } from '@/modules/heal/healTypes';
import { api, readApiJson } from '@/shared/api';

/**
 * How often the reflex's summary is re-read. The same floor the memory poller keeps, and for the same
 * reason: the ledger's numbers move only when an ending indexes or a chain lands, and the two things a
 * reader presses here — a cycle's Start/Stop, a switch — call `refresh()` themselves rather than waiting for the
 * tick. A summary is one process on this host and one JSON object, so a slow poll costs a skipped
 * reading rather than a queue of them.
 */
const HEAL_POLL_MS = 60_000;

/** The arrays the panel and the pill bar walk without a guard. */
const SUMMARY_ARRAYS = ['kinds', 'heals', 'ignore', 'cycles'] as const;

/**
 * The facts the worker reads off its flag family. `daily_cap: null` is NO CEILING and `model` is
 * always one of the two models — both VALUES, never absent keys. `model` is the one this guard exists
 * for: the panel's chip and the pills draw the model off it on their first render, and a worker that
 * answered without it would leave them dereferencing `undefined` — a render throw inside this tab,
 * which the workspace's boundary answers by blanking the whole main region. Better the panel's own
 * "could not be read" with its Retry than a tab that goes white.
 */
const SWITCH_KEYS = ['master', 'daily_cap', 'model', 'cycle'] as const;

/**
 * The body as a summary, or a throw the caller turns into `phase: 'error'`.
 *
 * THE STATUS IS READ, NOT ASSUMED. This transport returns the `Response` on every status — it does not
 * throw on a 502/503 — so the route's own refusal body (`{error}` from `heal.routes.ts`'s `emit`) would
 * otherwise be stored as a READY summary, and the panel dereferences `summary.switches.daily_cap` and
 * `summary.kinds` on the first render it draws. A render throw inside this tab is caught by the
 * workspace's error boundary, which blanks the whole main region — so the one state this guard exists
 * to reach, the panel's own "could not be read" with its Retry, would be the one state it could never
 * show. A body that is not the summary is a refusal for the same reason: unknown, not empty.
 */
function summaryOf(body: unknown): HealSummary {
  const summary = body as Partial<HealSummary> | null;
  const switches = summary !== null && typeof summary === 'object' ? summary.switches : undefined;
  const drawn = summary !== null && typeof summary === 'object'
    && typeof summary.live === 'number'
    && typeof switches === 'object' && switches !== null
    && SWITCH_KEYS.every((key) => key in switches)
    && SUMMARY_ARRAYS.every((key) => Array.isArray(summary[key]))
    // The Cycle pill prints `cycle_state.text` on its first render: an absent state is a refusal too.
    && typeof summary.cycle_state === 'object' && summary.cycle_state !== null;
  if (!drawn) throw new Error('the heal worker did not answer with a summary');
  return summary as HealSummary;
}

/**
 * The tab's picture of the reflex, and the one way to ask for it again.
 *
 * `summary` is `null` until the first answer lands, which is "not asked yet" and nothing else: the
 * workspace's tab gate weighs the ledger's live count, and a gate handed a fabricated zero would keep
 * the Heal tab shut for the first minute after every reload. `state` carries the three facts the panel
 * renders — loading, error, ready — so no consumer has to infer one from the other.
 */
type HealContextValue = {
  state: HealScreenState;
  summary: HealSummary | null;
  refresh: () => Promise<void>;
};

/**
 * `null` on purpose, not a filled-in default: a default object makes the hook's guard below
 * unreachable and lets a consumer mounted outside the provider read a summary nobody polls.
 */
const HealContext = createContext<HealContextValue | null>(null);

/**
 * The app's ONE heal poller — above the Router, so the panel, the two tab gates and the command
 * palette all read the same reading, and inside the auth gate, so it never asks against the login
 * screen. It holds the READING and nothing else: every control that changes something calls
 * `refresh()` and shows what the server read back, so no pressed button writes a value into this
 * state that the worker has not been seen to agree with.
 */
export function HealProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HealScreenState>({ phase: 'loading' });

  // Mount flag: a poll that resolves after this provider is gone must not set state.
  const mountedRef = useRef(true);
  // Which read this is. Two can be open at once — the interval's and the one a pressed control asks
  // for — so each takes a token.
  const newestReadRef = useRef(0);
  // The newest token that has ANSWERED. An older answer landing after it is dropped rather than
  // published: a poll that left BEFORE a press must not land after it and put the pre-press numbers
  // back on screen for a minute (the hazard `MemoryIntakeContext.tsx:50-56` names).
  const newestAnswerRef = useRef(0);

  const refresh = useCallback(async () => {
    const token = ++newestReadRef.current;
    let next: HealScreenState;
    try {
      // `readApiJson` and not `response.json()`: it throws on a non-2xx with the SERVER's own sentence
      // in hand, which is the reason the reader is shown below.
      const response = await api.heal.summary();
      next = { phase: 'ready', summary: summaryOf(await readApiJson<unknown>(response)) };
    } catch (error) {
      // The route answers the worker's own sentence on a refusal (`unreachable`, `unreadable`), so a
      // throw here is that sentence or this app's own network. Either way the reader is owed the words:
      // a ledger that cannot be read is neither a spinner nor the last reading still on screen.
      next = { phase: 'error', reason: error instanceof Error ? error.message : 'unreachable' };
    }
    // A reading, but not the newest one: the screen already shows something later than this.
    if (token < newestAnswerRef.current) return;
    newestAnswerRef.current = token;
    if (mountedRef.current) setState(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, HEAL_POLL_MS);
    // A backgrounded tab's interval is throttled to near-nothing, so coming back to the app is its own
    // reason to ask: what a person reads on return is a reading of now, not of whenever the browser
    // last let the timer through.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mountedRef.current = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const value = useMemo<HealContextValue>(() => ({
    state,
    // Only a READY summary is a summary. A failed poll leaves the gate with no count rather than a
    // stale one, because a badge that outlives its reading is a number nobody can check.
    summary: state.phase === 'ready' ? state.summary : null,
    refresh,
  }), [state, refresh]);

  return <HealContext.Provider value={value}>{children}</HealContext.Provider>;
}

/** The tab's picture, for the panel, the two tab gates and the command palette. */
export function useHeal(): HealContextValue {
  const value = useContext(HealContext);
  if (!value) {
    throw new Error('useHeal must be used within a HealProvider');
  }
  return value;
}
