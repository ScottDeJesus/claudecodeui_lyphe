/**
 * Publishes one message to an ntfy server.
 *
 * The message is POSTed as JSON to the server's BASE URL with the topic inside
 * the body — never as `<server>/<topic>` — because the topic is the only thing
 * standing between a stranger and the user's pushes, and a URL ends up in
 * fetch errors, proxies and logs. Publishing never throws: a failed push comes
 * back as a result and one warning, and the caller carries on.
 */

// Consumed by the ntfy channel and the ntfy action decisions: one tappable button (ntfy's `http` action).
export type NtfyAction = { action: 'http'; label: string; url: string; method: 'POST'; clear: true };

// Consumed by the ntfy channel and the notifications test route: one push, before clamping.
export type NtfyMessage = {
  title: string;
  message: string;
  priority: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
  actions?: NtfyAction[];
};

// Consumed by the ntfy channel and the notifications test route: where a push goes and how it authenticates.
export type NtfyTarget = { serverUrl: string; topic: string; token: string | null };

// Returned to the ntfy channel and, verbatim, to the Settings "Send test" button.
export type NtfyPublishResult = { ok: boolean; status: number | null; error: string | null };

const PUBLISH_TIMEOUT_MS = 5000;
const MAX_TITLE_CHARS = 200;
const MAX_MESSAGE_CHARS = 2000;
const MAX_ACTION_LABEL_CHARS = 30;
/** ntfy refuses a message carrying more than three actions. */
const MAX_ACTIONS = 3;
const MAX_ERROR_CHARS = 200;
/** What replaces a tap URL an ntfy server quoted back. Holds no `act?t=` — see `scrubSecrets`. */
const REDACTED_TOKEN = '[tap url redacted]';

/**
 * Every secret one outgoing push carries: the topic, the ntfy access token, and
 * each action button's URL together with the act token inside it. An ntfy server
 * that refuses a message may quote the message back, and an action token quoted
 * into a log line would be a live single-use approval sitting in the journal.
 */
function secretsOf(target: NtfyTarget, actions: NtfyAction[]): string[] {
  const urls = actions.map((action) => action.url);
  const actionTokens = urls.map((url) => /[?&]t=([^&]*)/.exec(url)?.[1] ?? '');
  return [target.topic, target.token ?? '', ...urls, ...actionTokens].filter(Boolean);
}

/**
 * Removes every secret from text bound for a log line or a client, then cuts any
 * act-route token shape that survived — a partial echo the exact matches above
 * could not catch. Scrubbed BEFORE clamping, so a cut never leaves half a secret.
 *
 * The marker left behind carries no `act?t=` of its own on purpose: that string
 * in a log line is how the audit recognises a leaked tap URL, and a scrubber
 * that wrote one would make every correctly scrubbed line read as a leak.
 */
function scrubSecrets(text: string, secrets: string[]): string {
  let scrubbed = text;
  for (const secret of secrets) {
    scrubbed = scrubbed.split(secret).join('');
  }
  return scrubbed.replace(/act\?t=[\w.~%-]*/g, REDACTED_TOKEN).trim().slice(0, MAX_ERROR_CHARS);
}

/** undici reports every network failure as "fetch failed"; the cause's code is the useful half. */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === 'string' ? `${error.message} (${cause.code})` : error.message;
}

function reportFailure(status: number | null, error: string): NtfyPublishResult {
  // The status and the scrubbed error only: topic, token, click URL and body never reach a log.
  console.warn('[ntfy] publish failed', status, error);
  return { ok: false, status, error };
}

/**
 * Sends one push and resolves with what the server said.
 *
 * Consumed by the ntfy channel (every notification) and the notifications
 * routes' `POST /ntfy/test`. Clamps title, message, action labels and the
 * action count to what ntfy accepts; times out after five seconds.
 */
export async function publishNtfy(target: NtfyTarget, message: NtfyMessage): Promise<NtfyPublishResult> {
  // Declared out here so the catch below scrubs with it too; the buttons' own secrets join it
  // inside the try, where a malformed message is still a returned failure and never a throw.
  let secrets = secretsOf(target, []);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (target.token) headers.Authorization = `Bearer ${target.token}`;

    const actions = (message.actions ?? [])
      .slice(0, MAX_ACTIONS)
      .map((action) => ({ ...action, label: action.label.slice(0, MAX_ACTION_LABEL_CHARS) }));
    secrets = secretsOf(target, actions);

    const response = await fetch(target.serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        topic: target.topic,
        title: message.title.slice(0, MAX_TITLE_CHARS),
        message: message.message.slice(0, MAX_MESSAGE_CHARS),
        priority: message.priority,
        tags: message.tags,
        click: message.click,
        actions: actions.length ? actions : undefined,
      }),
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });

    if (response.ok) {
      // Drained so the keep-alive socket returns to the pool instead of waiting on GC.
      await response.arrayBuffer().catch(() => undefined);
      return { ok: true, status: response.status, error: null };
    }

    const responseText = await response.text().catch(() => '');
    return reportFailure(response.status, scrubSecrets(responseText, secrets) || `HTTP ${response.status}`);
  } catch (error) {
    return reportFailure(null, scrubSecrets(describeFailure(error), secrets));
  }
}
