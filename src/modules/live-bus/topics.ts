/**
 * The topic vocabulary, and the only place a topic SHAPE is admitted.
 *
 * A topic is a NAME the host owns, never an address a widget hands us. That distinction is the
 * whole control on exfiltration: a widget document is untrusted model output, it can reach the
 * network only by navigating itself away, and what it could carry out is exactly what the host
 * pushed into it. So a widget never names an endpoint — it names a topic, and this file decides
 * whether such a topic may exist at all.
 *
 * An anchored pattern rather than a prefix test, and the difference is not stylistic. `topic.startsWith`
 * would admit `dispatcher:all/../../etc/passwd`, `dispatcher:https://elsewhere/x` and a topic 40 kB long,
 * each of which reads as "a dispatcher topic" to a prefix and as nonsense to everything downstream.
 * Anchored patterns with an explicit character class and an explicit length say what a topic may
 * contain, and everything else is refused by construction.
 *
 * Adding a lane means adding a pattern HERE and nowhere else — the bus, the bridge and every feed
 * ask this file rather than carrying a second opinion about what a topic looks like.
 */
export const LIVE_TOPIC_ALLOWLIST: readonly RegExp[] = [
  // The launcher souls a session started by hand, as one array. No per-launch topic yet: the only
  // reader is the pin above the composer, which wants the whole picture, and a topic nothing
  // subscribes to is a topic with no way to tell it has gone stale.
  /^souls:\*$/,
  // Every plan the dispatcher lane can see, as one array — the plan cards' whole picture. One
  // picture of the whole store, and a topic nothing subscribes to is a topic with no way to tell it
  // has gone stale.
  /^dispatcher:all$/,
  // The estate's activity as one DIGEST — how many edits and executions the last window carried and
  // when the newest one landed. A digest and never the raw rows: the estate's stream is coalesced
  // and flushed up to ten times a second, and this bus retains one value per topic and compares
  // every publish by `JSON.stringify` (`LiveBusContext`), so a lane carrying raw rows would
  // stringify the whole payload ten times a second for as long as the estate is busy, whether or
  // not anything is listening. No per-repo topic for the same reason `souls:*` has no per-launch
  // one: nothing subscribes to one.
  /^universe:\*$/,
];

/** Whether a topic may be published or subscribed. A non-string is refused before any pattern runs. */
export function isAllowedTopic(topic: unknown): topic is string {
  if (typeof topic !== 'string') return false;
  return LIVE_TOPIC_ALLOWLIST.some((pattern) => pattern.test(topic));
}

/**
 * The topic carrying every plan on the dispatcher's lane — the whole picture, as one array.
 * Published by `DispatcherFeed`, read by the plan cards and by whatever counts them.
 */
export const DISPATCHER_ALL_TOPIC = 'dispatcher:all';

/** The topic carrying every launcher soul the lane can see, running and recently ended alike. */
export const SOULS_ALL_TOPIC = 'souls:*';

/**
 * The topic carrying the estate's activity digest — how many edits and executions the last window
 * held, never the rows themselves. Published by `UniverseFeed`, read by whatever wants to watch the
 * estate without opening its tab.
 */
export const UNIVERSE_ALL_TOPIC = 'universe:*';
