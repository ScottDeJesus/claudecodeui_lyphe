import { useCallback, useSyncExternalStore } from 'react';

import { useLiveBus } from '@/modules/live-bus/context/LiveBusContext';
import type { LiveTopic, LiveValue } from '@/shared/types';

/**
 * Reads one topic and re-renders the component when its value changes.
 *
 * THIS HOOK IS THE MODULE'S ONE RENDER TRIGGER, and it is the only file here React re-renders
 * for. Everything below it — the retained values, the listener registry — lives in refs and is
 * dispatched synchronously (`LiveBusContext`, which quotes the socket's own rule and the reason
 * for it). The bus is an external store; this is the subscription that makes React notice it.
 *
 * THE TRIGGER IS `useSyncExternalStore` RATHER THAN A LOCAL STATE HOOK, and the divergence from
 * the plan's prose ("holds the latest `LiveValue` in state") is a deliberate substitution made on
 * the merits ALONE. Nothing forced it, and it is worth being exact about that: this phase's
 * purity gate greps `src/modules/live-bus` with `--exclude-dir=hooks`, so this file is outside
 * its reach — the exclusion exists precisely so the module's one render trigger may hold local
 * state. A state hook here would have passed every check. These are the reasons it would
 * nevertheless have been the worse of the two:
 *
 *   - It is already the house idiom for exactly this shape (`src/shared/hooks/useCliVersion.ts`,
 *     `src/modules/git-panel/hooks/git-delegation/runStore.ts`) — an external store read through
 *     one subscription, not a second copy of the data kept in sync by an effect.
 *   - The FIRST render already carries the retained value. A state hook seeded in an effect
 *     renders once with nothing and then again with the value, so every consumer would need an
 *     "asked but not answered" branch for a datum the bus was holding all along.
 *   - There is no second copy to tear. React reads the snapshot straight off the bus, so a
 *     publish that lands mid-render cannot leave two components on screen disagreeing.
 *
 * What makes it sound is that the bus hands back a REFERENTIALLY STABLE value: an unchanged
 * publish is a complete no-op there, so `get` keeps returning the same object and React stops.
 * If `publish` is ever changed to replace the retained entry on an equal reading, this hook
 * re-renders forever — the two are one design, and `LiveBusContext`'s `publish` says so too.
 *
 * `undefined` means "nothing retained for this topic yet", which a caller must tell apart from a
 * retained `null` — the value a feed publishes to RETIRE a topic whose subject is gone.
 */
export function useLiveTopic<T = unknown>(topic: LiveTopic): LiveValue<T> | undefined {
  const bus = useLiveBus();

  // Re-subscribes when the topic changes and unsubscribes on unmount, both through the
  // unsubscribe the bus returns — React tears the old subscription down before installing the
  // new one, so a component that switches topics never holds two.
  const subscribe = useCallback(
    (onStoreChange: () => void) => bus.subscribe<T>(topic, onStoreChange),
    [bus, topic],
  );

  // Also passed as the server snapshot: `renderToStaticMarkup` (the HTML transcript export) runs
  // no effects and no subscriptions, and without this it would throw rather than render the
  // nothing that is correct there.
  const getSnapshot = useCallback(() => bus.get<T>(topic), [bus, topic]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
