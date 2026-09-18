/**
 * The ntfy phone-push channel of the notification orchestrator.
 *
 * Its on/off switch is the user's ntfy endpoint row (`enabled` and a stored
 * topic) — never `preferences.channels.*`, which are derived copies of
 * endpoint state that the client's settings normalizer would write back as
 * `false` for a channel it does not know. Sending never rejects: a failed
 * push is logged once by the publisher and the next channel is unaffected.
 *
 * Before publishing it skips a session the user is watching in a browser tab,
 * attaches tap-to-answer buttons to a permission request, and collapses bursts
 * of the same code into the first push plus one summary per minute.
 */

import { buildNtfyActions } from '@/modules/notifications/services/ntfy-action-decisions.service.js';
import { getAppUrl, getNtfyConfig } from '@/modules/notifications/services/ntfy-config.service.js';
import type { NtfyConfig } from '@/modules/notifications/services/ntfy-config.service.js';
import { createFloodControl } from '@/modules/notifications/services/ntfy-flood-control.service.js';
import { publishNtfy } from '@/modules/notifications/services/ntfy-publish.service.js';
import type {
  NtfyAction,
  NtfyMessage,
  NtfyPublishResult,
  NtfyTarget,
} from '@/modules/notifications/services/ntfy-publish.service.js';
import { isSessionWatched } from '@/modules/notifications/services/session-presence.service.js';

/** The slice of an orchestrator event the channel reads. */
type ChannelEvent = {
  provider?: string | null;
  sessionId?: string | null;
  kind?: string | null;
  code?: string | null;
  meta?: Record<string, unknown> | null;
};

type ChannelSendInput = {
  userId: unknown;
  event: ChannelEvent;
  payload: { title: string; body: string };
};

/** What a window's summary needs: whose it is, and the latest suppressed push's title and link. */
type SuppressedPush = { userId: unknown; title: string; click: string | undefined };

/** Limits that stop work outright get the urgent treatment; the rest are advisories. */
const HARD_LIMIT_CODES = new Set(['limit.reached', 'limit.out_of_credits']);

/** Codes that can arrive in bursts, collapsed per user, provider, code and session. */
const COLLAPSIBLE_CODES = new Set([
  'api.error',
  'run.failed',
  'session.stuck',
  'limit.warning',
  'limit.reached',
  'limit.overage',
  'agent.notification',
  'run.stopped',
]);

/** One minute — the summary's own wording ("in the last minute") depends on it. */
const FLOOD_WINDOW_MS = 60_000;

/** The latest suppressed push per open collapse window; emptied as each window closes. */
const lastSuppressedByKey = new Map<string, SuppressedPush>();

const floodControl = createFloodControl({
  windowMs: FLOOD_WINDOW_MS,
  onWindowClose: (collapseKey, suppressedCount) => {
    const last = lastSuppressedByKey.get(collapseKey);
    lastSuppressedByKey.delete(collapseKey);
    if (last) void publishSummary(last, suppressedCount);
  },
});

function targetFor(config: NtfyConfig): NtfyTarget {
  return { serverUrl: config.serverUrl, topic: config.topic, token: config.token };
}

/**
 * One push standing for a window's repeats: default priority, whatever the
 * repeats were, and no collapse key or token in its text. The config is read
 * again because the user may have switched ntfy off while the window was open.
 */
async function publishSummary(last: SuppressedPush, suppressedCount: number): Promise<void> {
  try {
    const config = getNtfyConfig(Number(last.userId));
    if (!config?.enabled || !config.topic) return;
    await publishNtfy(targetFor(config), {
      title: `${last.title} ×${suppressedCount + 1}`,
      message: `${suppressedCount} more in the last minute`,
      priority: 3,
      tags: ['bell'],
      click: last.click,
    });
  } catch (error) {
    console.warn('[ntfy] summary skipped', error instanceof Error ? error.message : error);
  }
}

function priorityFor(event: ChannelEvent): NtfyMessage['priority'] {
  // A plan run ends a few times a day and closes hours of work: its finish is not a chat turn's quiet stop.
  if (event.code === 'runner.finished') return 3;
  switch (event.kind) {
    case 'action_required':
    case 'error':
      return 4;
    case 'limit':
      return HARD_LIMIT_CODES.has(event.code ?? '') ? 4 : 3;
    case 'stop':
    case 'background':
      return 2;
    default:
      return 3;
  }
}

/** ntfy renders a tag that names an emoji as that emoji in front of the title. */
function tagsFor(event: ChannelEvent): string[] {
  // A blocked plan asks for a hand; nothing crashed, so it is not the siren a failed run gets.
  if (event.code === 'runner.blocked') return ['warning'];
  switch (event.kind) {
    case 'action_required':
      return ['question'];
    case 'error':
      return ['rotating_light'];
    case 'limit':
      if (HARD_LIMIT_CODES.has(event.code ?? '')) return ['no_entry'];
      return event.code === 'limit.reset' ? ['white_check_mark'] : ['warning'];
    case 'stop':
      return ['white_check_mark'];
    default:
      return ['bell'];
  }
}

/** Where a tap opens: the session when both are known, the app root when only the URL is. */
function clickFor(appUrl: string | null, sessionId: string | null | undefined): string | undefined {
  if (!appUrl) return undefined;
  return sessionId ? `${appUrl}/session/${sessionId}` : `${appUrl}/`;
}

/**
 * A finished run earns a push only when it ran at least the user's threshold.
 * An unknown duration never does: "it finished" without "how long" is noise.
 */
function ranLongEnough(event: ChannelEvent, longRunMinutes: number): boolean {
  const durationMs = event.meta?.durationMs;
  return typeof durationMs === 'number' && durationMs >= longRunMinutes * 60_000;
}

/**
 * The tap-to-answer buttons, only for a permission request that names its
 * request id, and only when the phone has an app URL to send the tap to.
 * A failure here (say, the signing secret cannot be stored) costs the
 * buttons, never the push: the most urgent push still says "look".
 */
function actionsFor(userId: unknown, event: ChannelEvent, appUrl: string | null): NtfyAction[] {
  const requestId = event.meta?.requestId;
  if (event.code !== 'permission.required' || typeof requestId !== 'string' || !requestId || !appUrl) return [];
  try {
    return buildNtfyActions({
      requestId,
      userId: String(userId),
      sessionId: event.sessionId ?? null,
      toolName: typeof event.meta?.toolName === 'string' ? event.meta.toolName : '',
      toolInput: event.meta?.toolInput,
      appUrl,
    });
  } catch (error) {
    console.warn('[ntfy] answer buttons skipped', error instanceof Error ? error.message : error);
    return [];
  }
}

function collapseKeyFor(userId: unknown, event: ChannelEvent): string | null {
  if (!COLLAPSIBLE_CODES.has(event.code ?? '')) return null;
  // A limit push's title names its window, so two windows must never share one "×N" summary.
  const window = typeof event.meta?.rateLimitType === 'string' ? `:${event.meta.rateLimitType}` : '';
  return `${userId}:${event.provider}:${event.code}:${event.sessionId ?? 'none'}${window}`;
}

/** A tab reports its user id as the socket's; anything else cannot be watching. */
function presenceUserId(userId: unknown): string | number | null {
  return typeof userId === 'string' || typeof userId === 'number' ? userId : null;
}

// Consumed by the notification orchestrator, registered as the last entry of its channel list.
export const ntfyChannel = {
  id: 'ntfy',

  /** Called synchronously inside the orchestrator's fan-out, so it must never throw. */
  isEnabled(_preferences: unknown, userId: unknown): boolean {
    try {
      const config = getNtfyConfig(Number(userId));
      return Boolean(config?.enabled && config.topic);
    } catch (error) {
      console.warn('[ntfy] enablement check failed', error instanceof Error ? error.message : error);
      return false;
    }
  },

  /** Resolves with the publish result, or null when the event is not pushed. Never rejects. */
  async send({ userId, event, payload }: ChannelSendInput): Promise<NtfyPublishResult | null> {
    try {
      const config = getNtfyConfig(Number(userId));
      if (!config?.enabled || !config.topic) return null;
      if (event.sessionId && isSessionWatched(presenceUserId(userId), event.sessionId)) return null;
      if (event.code === 'run.stopped' && !ranLongEnough(event, config.longRunMinutes)) return null;

      const appUrl = getAppUrl();
      const click = clickFor(appUrl, event.sessionId);
      const actions = actionsFor(userId, event, appUrl);
      const message: NtfyMessage = {
        title: payload.title,
        message: payload.body,
        priority: priorityFor(event),
        tags: tagsFor(event),
        click,
        actions: actions.length ? actions : undefined,
      };

      const collapseKey = collapseKeyFor(userId, event);
      if (collapseKey && !floodControl.admit(collapseKey)) {
        lastSuppressedByKey.set(collapseKey, { userId, title: payload.title, click });
        return null;
      }

      return await publishNtfy(targetFor(config), message);
    } catch (error) {
      console.warn('[ntfy] send skipped', error instanceof Error ? error.message : error);
      return null;
    }
  },
};
