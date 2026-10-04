/**
 * Where a tap on a push lands.
 *
 * The landing travels as a PATH, not a URL: the payload carries it to the service
 * worker and the desktop app, and the ntfy channel appends it to the instance's
 * app URL — three openers that each join it to their own origin. One function
 * decides it, so a plan's prompt lands on its card whichever door the tap came
 * through, and every other event lands exactly where it did before.
 */

/** The plan a prompt's `meta` names, when it names one: a non-empty string under `plan`. */
function readPlanName(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const plan = (meta as { plan?: unknown }).plan;
  return typeof plan === 'string' && plan.length > 0 ? plan : null;
}

/**
 * `encodeURIComponent`, or `null` for the one thing it refuses: a value holding a lone surrogate
 * (`URIError: URI malformed`). The parts of a landing are the store's own text — a plan name is
 * written by planners — and a payload build that throws costs the whole push, so a part that
 * cannot be spelled falls back instead of throwing.
 */
function encodeOrNull(value: string): string | null {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The app path a tap on a push opens: the event's session, or the root — and, for a plan's prompt (a `permission.required` whose `meta.plan` names a plan), `?runner=<plan>`, the Roadmap tab's In flight face on that plan's card. The one place a push's landing is decided.
 *
 * Consumed by the notification orchestrator, which puts it on the payload's `data.path` for the
 * service worker and the desktop app, and by the ntfy channel, which appends it to the app URL for
 * the push's click and for the `view` button of an option that takes the operator's note.
 */
export function landingPathOf(event: { code?: string | null; sessionId?: string | null; meta?: unknown }): string {
  const session = event.sessionId ? encodeOrNull(event.sessionId) : null;
  const base = session === null ? '/' : `/session/${session}`;
  const plan = event.code === 'permission.required' ? readPlanName(event.meta) : null;
  const runner = plan === null ? null : encodeOrNull(plan);
  // An unspellable plan costs only the `runner`: its session is still landed on. An unspellable
  // session costs the session, and the landing falls to the root.
  return runner === null ? base : `${base}?runner=${runner}`;
}
