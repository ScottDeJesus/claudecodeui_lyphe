/**
 * The topic vocabulary, and the only place a topic SHAPE is admitted.
 *
 * A topic is a NAME the host owns, never an address a widget hands us. That distinction is the
 * whole control on exfiltration: a widget document is untrusted model output, it can reach the
 * network only by navigating itself away, and what it could carry out is exactly what the host
 * pushed into it. So a widget never names an endpoint — it names a topic, and this file decides
 * whether such a topic may exist at all.
 *
 * Two regexes rather than a prefix test, and the difference is not stylistic. `topic.startsWith`
 * would admit `runner:../../etc/passwd`, `runner:https://elsewhere/x` and a topic 40 kB long,
 * each of which reads as "a runner topic" to a prefix and as nonsense to everything downstream.
 * Anchored patterns with an explicit character class and an explicit length say what a topic may
 * contain, and everything else is refused by construction.
 *
 * Adding a lane means adding a pattern HERE and nowhere else — the bus, the bridge and every feed
 * ask this file rather than carrying a second opinion about what a topic looks like.
 */
export const LIVE_TOPIC_ALLOWLIST: readonly RegExp[] = [
  // The whole picture: every run the plan-runner lane can see, as one array.
  /^runner:\*$/,
  // One run by id. The class and the ceiling are the server route's own
  // (`^[A-Za-z0-9._-]{1,120}$`), so a topic the bus admits is an id the route would too.
  /^runner:[A-Za-z0-9._-]{1,120}$/,
];

/** Whether a topic may be published or subscribed. A non-string is refused before any pattern runs. */
export function isAllowedTopic(topic: unknown): topic is string {
  if (typeof topic !== 'string') return false;
  return LIVE_TOPIC_ALLOWLIST.some((pattern) => pattern.test(topic));
}

/** The topic carrying every run the lane can see. One spelling, so a producer and a reader cannot drift. */
export const RUNNER_ALL_TOPIC = 'runner:*';

/**
 * The topic for one run. Deliberately NOT validating the id: an id that fails the allowlist
 * yields a topic `publish` and `subscribe` both refuse on their own, which is one refusal in one
 * place rather than a second policy that could disagree with it.
 */
export function runnerTopic(runId: string): string {
  return `runner:${runId}`;
}
