import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

import { isAllowedTopic } from '@/modules/live-bus/topics';
import type { LiveBus, LiveTopic, LiveValue } from '@/shared/types';

/** What a subscriber is handed. Internally untyped; the generic signatures below narrow it per call. */
type Listener = (value: LiveValue) => void;

/**
 * One topic's retained reading, plus the JSON it was compared as.
 *
 * The JSON is carried rather than recomputed so an unchanged reading costs one stringify of the
 * INCOMING payload instead of two. It is `null` when the payload could not be stringified at all
 * (a cycle, a BigInt): unserialisable is treated as always-changed, which over-notifies rather
 * than silently swallowing a real update.
 */
type Retained = { value: LiveValue; json: string | null };

/**
 * `null` on purpose, not a filled-in default: a default object would make the hook's guard below
 * unreachable and let a consumer mounted outside the provider publish into a bus nobody reads.
 */
const LiveBusContext = createContext<LiveBus | null>(null);

/** Stringify for comparison only. A payload that cannot be serialised compares as always-different. */
function comparableJson(payload: unknown): string | null {
  try {
    return JSON.stringify(payload) ?? 'undefined';
  } catch {
    return null;
  }
}

/**
 * The app's ONE live bus: a retained value per topic, dispatched synchronously to whoever asked.
 *
 * THE BUS KNOWS NO PRODUCER. It imports no transport, calls no endpoint and names no frame kind;
 * it retains, dispatches, and admits topics, and that is the whole of it. What fills it is a
 * FEED — a headless component owned by the module whose data it carries, which subscribes to
 * whatever it likes and calls `publish`. The first is `RunnerFeed` in `src/modules/plan-runner/`;
 * a second (git delegation, Task Master) is a sibling `*Feed.tsx` in its own module and never a
 * line in this directory. That is what keeps this file from growing a switch over frame kinds.
 *
 * THE REGISTRY IS REFS, NOT REACT STATE, and the rule is the socket's own:
 *
 * > events are dispatched synchronously to every listener, so rapid back-to-back frames
 * > cannot be coalesced or dropped. Frames are deliberately not copied into React state; each
 * > listener updates only the state owned by the feature that handles it.
 * > — `src/shared/context/WebSocketContext.tsx`
 *
 * The bus sits directly downstream of that socket and inherits the hazard whole. Hold the
 * retained values in React state instead and two publishes in one tick collapse into a single
 * render carrying only the later one — which for a runner frame plus a retirement means the
 * retirement lands and the picture that explains it does not. Refs make a publish a function
 * call: by the time `publish` returns, every listener has run. The one render trigger in this
 * module is `useLiveTopic`, which is the only file here React re-renders for.
 *
 * A listener that throws is caught individually, so one broken widget cannot take down the
 * others waiting behind it on the same topic.
 */
export function LiveBusProvider({ children }: { children: ReactNode }) {
  // The retained value per topic — the picture a subscriber arriving LATE is replayed, which is
  // what lets a widget mount mid-run and start with data instead of with a blank box. A ref
  // rather than state because it is read synchronously inside `publish` and must never re-render
  // this provider: everything in the app sits under it.
  const retainedRef = useRef(new Map<LiveTopic, Retained>());

  // Who is listening to what. A ref for the same two reasons the socket's listener set is one —
  // it is walked synchronously during dispatch, and adding a subscriber must not re-render the
  // whole tree. Empty sets are deleted rather than left behind, so an unmounted widget's topic
  // does not sit in this map for the life of the page.
  const listenersRef = useRef(new Map<LiveTopic, Set<Listener>>());

  // The disallowed topics already reported. A ref because nothing renders from it, and needed at
  // all because a feed re-publishes on every reading — without it one bad topic would reprint its
  // warning every couple of seconds for as long as its subject existed.
  const refusedRef = useRef(new Set<string>());

  const publish = useCallback(<T,>(topic: LiveTopic, payload: T, at: number = Date.now()): void => {
    // Refused, and SAID ONCE. Dropping it stays the behaviour — a producer must not be able to
    // invent a topic — but a silent drop is a debugging trap: the subject goes on existing in
    // whatever list carries it while its own topic never carries anything, and a widget waiting on
    // that topic waits forever with no cause attached anywhere. Only a feed can reach this (the
    // bridge refuses a widget's topic before the bus ever sees it), so this is always a producer
    // bug, and a warning is the cheapest place to learn it.
    if (!isAllowedTopic(topic)) {
      const name = typeof topic === 'string' ? topic : String(topic);
      if (!refusedRef.current.has(name)) {
        refusedRef.current.add(name);
        console.warn(
          `[LiveBus] refused to publish ${JSON.stringify(name)}: not in the topic allowlist ` +
            `(src/modules/live-bus/topics.ts). Nothing is retained and no listener is notified.`,
        );
      }
      return;
    }

    const json = comparableJson(payload);
    const held = retainedRef.current.get(topic);
    // An identical reading is a COMPLETE no-op: nobody is notified, and the retained entry keeps
    // both its identity and its `at`. Identity matters because `useLiveTopic` reads this map as an
    // external store and React compares snapshots by reference — a fresh object holding the same
    // data would re-render every subscriber on every poll tick. And `at` is the instant the value
    // became TRUE, not the last instant something confirmed it, which is what makes a feed's
    // "only overwrite when newer" guard mean something.
    if (held && json !== null && held.json === json) return;

    const value: LiveValue<T> = { payload, at };
    retainedRef.current.set(topic, { value: value as LiveValue, json });

    const listeners = listenersRef.current.get(topic);
    if (!listeners) return;

    // Dispatched over a COPY. A listener may unsubscribe (a widget unmounting) or subscribe (a
    // widget mounting) from inside its own callback, and mutating the set being walked would
    // either skip a listener that was there when the value was published or deliver this value
    // twice to one that just arrived — once here and once as its synchronous replay.
    for (const listener of Array.from(listeners)) {
      try {
        listener(value as LiveValue);
      } catch (error) {
        console.error(`[LiveBus] listener for "${topic}" threw:`, error);
      }
    }
  }, []);

  const subscribe = useCallback(<T,>(topic: LiveTopic, listener: (value: LiveValue<T>) => void): (() => void) => {
    // A disallowed topic gets a no-op and NO replay — not an empty subscription that might one day
    // start delivering. The refusal a widget actually sees is the bridge's `topic not allowed`
    // error message; this is the bus refusing to hold the registration at all.
    if (!isAllowedTopic(topic)) return () => {};

    const listeners = listenersRef.current.get(topic) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    listenersRef.current.set(topic, listeners);

    // Replayed SYNCHRONOUSLY, before this function returns. A subscriber must not have to reason
    // about whether it arrived before or after the producer: either it gets the retained value on
    // the way in, or there is none to get.
    const held = retainedRef.current.get(topic);
    if (held) {
      try {
        listener(held.value as LiveValue<T>);
      } catch (error) {
        console.error(`[LiveBus] replay to a new subscriber of "${topic}" threw:`, error);
      }
    }

    return () => {
      const current = listenersRef.current.get(topic);
      if (!current) return;
      current.delete(listener as Listener);
      if (current.size === 0) listenersRef.current.delete(topic);
    };
  }, []);

  const get = useCallback(<T,>(topic: LiveTopic): LiveValue<T> | undefined => {
    return retainedRef.current.get(topic)?.value as LiveValue<T> | undefined;
  }, []);

  // Identity is stable for the life of the provider: all three callbacks close over refs alone and
  // nothing here re-renders. A bus that changed identity would re-run every consumer's effect —
  // which is to say, tear down and re-register every widget's subscription — on any parent render.
  const bus = useMemo<LiveBus>(() => ({ subscribe, get, publish, isAllowedTopic }), [subscribe, get, publish]);

  return <LiveBusContext.Provider value={bus}>{children}</LiveBusContext.Provider>;
}

/** The bus, or a loud failure. A consumer outside the provider is a wiring mistake, never a silence. */
export function useLiveBus(): LiveBus {
  const bus = useContext(LiveBusContext);
  if (!bus) {
    throw new Error('useLiveBus must be used within a LiveBusProvider');
  }
  return bus;
}
