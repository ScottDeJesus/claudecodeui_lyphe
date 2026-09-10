import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useLiveBus } from '@/modules/live-bus';
import type { WidgetHostHandlers, WidgetHostMessage } from '@/shared/types';

/**
 * How many distinct topics ONE frame may hold at once.
 *
 * Not a performance number — a blast-radius one. A widget is untrusted model output, and every
 * live subscription is a standing obligation the page carries on its behalf: a listener in the
 * bus, and a `postMessage` per publish for as long as the widget is on screen. Without a ceiling
 * a single fence could open thousands in a loop and make every publish walk them. Sixteen is
 * generous for anything a person would read in one card and small enough that a runaway fence is
 * refused in its first tick, IN WORDS, rather than silently degrading the transcript around it.
 */
const MAX_TOPICS_PER_FRAME = 16;

/**
 * The live bus's half of the widget protocol: what one frame's `subscribe` and `unsubscribe`
 * actually do.
 *
 * One instance per frame, and the subscriptions it opens belong to that frame alone — which is
 * what makes the unmount sweep below both possible and necessary. `useWidgetHost` owns the
 * message listener, the identity check and the revoke rule; this owns only the answer.
 *
 * WHAT CROSSES THE BOUNDARY IS `{ type: 'data', topic, payload, at }` — not the `LiveValue` the
 * bus holds. That is the protocol the in-frame bridge script has spoken since it was written, so
 * the value is unwrapped here rather than the frame learning a second shape for the same datum.
 *
 * A REFUSAL IS ALWAYS AN ANSWER. Both reasons are sent back to the frame in words, because a
 * widget waiting forever on a topic cannot tell a refusal from a producer that has nothing to
 * say yet — and a widget that can tell is one that can render "not available" instead of a
 * spinner that never stops.
 */
export function useWidgetBridge(): WidgetHostHandlers {
  const bus = useLiveBus();

  // This frame's live subscriptions, topic to its unsubscribe. Essential rather than derived: it
  // is the only handle on listeners registered in a bus that outlives the frame, so it is what
  // the unmount sweep spends and what the per-frame cap is counted from. A ref rather than state
  // because subscribing must not re-render the widget — a render would rebuild the handlers and,
  // through them, the very subscriptions being counted.
  const subscriptionsRef = useRef(new Map<string, () => void>());

  const onSubscribe = useCallback(
    (topic: string, send: (message: WidgetHostMessage) => void) => {
      // A frame's bridge script posts `subscribe` only on the FIRST in-frame subscriber of a
      // topic, so a repeat can only be a forged message. Answered by doing nothing rather than by
      // subscribing twice: a second registration would overwrite the first unsubscribe in this
      // map and leak a listener that no unmount could ever reach.
      if (subscriptionsRef.current.has(topic)) return;

      // Refused before the cap is even consulted, so a widget naming a URL always hears the same
      // thing — the vocabulary is the boundary, and it is not negotiable by arriving early.
      if (!bus.isAllowedTopic(topic)) {
        send({ type: 'error', topic, reason: 'topic not allowed' });
        return;
      }

      if (subscriptionsRef.current.size >= MAX_TOPICS_PER_FRAME) {
        send({ type: 'error', topic, reason: 'too many subscriptions' });
        return;
      }

      // The retained value is replayed synchronously inside this call, so a widget's `fn` runs
      // before its own `live.subscribe` has returned — which is exactly the promise the bridge
      // script makes to a widget author.
      const unsubscribe = bus.subscribe(topic, (value) => {
        send({ type: 'data', topic, payload: value.payload, at: value.at });
      });
      subscriptionsRef.current.set(topic, unsubscribe);
    },
    [bus],
  );

  const onUnsubscribe = useCallback((topic: string) => {
    const unsubscribe = subscriptionsRef.current.get(topic);
    // A topic this frame never held is not an error to report back: the frame is untrusted, and
    // answering it would tell a probing widget which topics some OTHER frame is holding.
    if (!unsubscribe) return;
    unsubscribe();
    subscriptionsRef.current.delete(topic);
  }, []);

  // The sweep. A frame is unmounted by anything from the reader scrolling a message away to the
  // streaming split retracting over a live widget — none of which the widget gets to hear about,
  // so nothing inside it will ever send the `unsubscribe` that would clean up after it. Without
  // this, every widget ever rendered in a session leaves its listeners in the bus, and each
  // publish walks a growing list posting into frames that no longer exist.
  useEffect(() => {
    const subscriptions = subscriptionsRef.current;
    return () => {
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    };
  }, []);

  // Stable while the bus is, so the host's handler ref is not rewritten on every parent render.
  return useMemo(() => ({ onSubscribe, onUnsubscribe }), [onSubscribe, onUnsubscribe]);
}
