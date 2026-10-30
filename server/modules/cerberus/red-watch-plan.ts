import type { CerberusRedAlertClosedBy, CerberusRedAlertRow } from '@/modules/database/index.js';
import type { CerberusRedItem } from '@/modules/notifications/index.js';
import type { CerberusCheckView, CerberusOverview } from '@/shared/cerberus-types.js';

/**
 * The red watch's judgment, pure: given the fleet as the overview reads it, the open incidents and the clock,
 * which checks are newly worth a page, which are due a reminder, which are green again, and which incidents
 * simply end without a word. It reads nothing and writes nothing, so the tick (`red-watch.service.ts`) is
 * this plan applied to the store, and a plan can be checked by handing it a fleet.
 *
 * A CANDIDATE is a check of the overview's `needsYou` that is `failing` or `denied` (never `warn`: that is
 * for the tab), unmuted, on a node that is reporting, whose status has lasted at least `RED_AFTER_MS` by its
 * `since`. `since` is on the warden's clock, so it is brought onto center's with the node's offset before it
 * is compared with the overview's `now`.
 *
 * AN OPEN INCIDENT ends one of four ways, judged in this order:
 *   - its check left the fleet, or its node went silent or never spoke  → closed `gone`, silent;
 *   - its check is muted                                                 → closed `mute`, silent;
 *   - its check is `ok`                                                  → closed `ok`, and the recovery is pushed;
 *   - still a candidate and 6 h past its last push                       → a reminder, the incident stays open.
 * Anything else (the check `warn`, `unknown`, paused for a restart, or red for less than an hour since it
 * flapped) leaves the incident as it is: a flap is not a new incident and must not be a new page.
 *
 * A RE-OPEN OF THE SAME RED AFTER A SILENT CLOSE WAITS OUT THE CADENCE. A check muted for ten minutes, or on a node
 * that dropped for one, comes back red with its old `since` — an hour old at least — so without a rule it would be
 * paged again at once. The incident that closed `mute` or `gone` was last pushed at `max(notified_at,
 * last_reminder_at)`; a new one opens only once `REMINDER_EVERY_MS` has passed since. It is the SAME red while the
 * check's red began no later than the moment that incident opened (an incident opens only for a red already an hour
 * old, so a red that is still the same one began an hour before `opened_at`, give or take a clock offset). A red that
 * began after it is a new episode — the check recovered while the mute or the silence hid it — and, like a close by
 * `ok`, waits for nothing: it has to last its own hour to be a candidate at all.
 *
 * Consumed by `red-watch.service.ts`.
 */

/** How long a check must have been failing or denied before it is paged. One threshold for the whole fleet. */
export const RED_AFTER_MS = 60 * 60_000;

/** How often a reminder repeats while an incident stays open, and the wait before a silently closed one may re-open. */
export const REMINDER_EVERY_MS = 6 * 60 * 60_000;

/** The statuses that page. `warn` never does. */
const PAGING_STATUSES: ReadonlySet<string> = new Set(['failing', 'denied']);

export type RedWatchPlan = {
  /** Checks to open an incident for and page as newly red; `redSince` is when the red began, on center's clock. */
  opens: Array<{ item: CerberusRedItem; redSince: number }>;
  reminders: Array<{ id: number; item: CerberusRedItem }>;
  /** Incidents whose check is `ok`; each item's `minutes` is how long the check was red. */
  recoveries: Array<{ id: number; item: CerberusRedItem }>;
  /** Incidents that end with no push. */
  closes: Array<{ id: number; by: Exclude<CerberusRedAlertClosedBy, 'ok'> }>;
};

export type RedWatchInputs = {
  overview: CerberusOverview;
  open: CerberusRedAlertRow[];
  /** The newest ended incident of a check, or null. */
  lastClosed: (node: string, key: string) => CerberusRedAlertRow | null;
  /** Center's clock minus the node's, in ms: what brings a node's `since` onto center's clock. */
  clockOffsetMs: (node: string) => number;
};

/** A check as a push names it. `minutes` is whole minutes, rounded down. */
function itemOf(check: CerberusCheckView, minutes: number): CerberusRedItem {
  return {
    node: check.node,
    key: check.key,
    label: check.label ?? check.key,
    status: check.status,
    minutes: Math.max(0, Math.floor(minutes)),
    reason: check.value ?? '',
  };
}

/** When the last push about an incident went out: its page or its latest reminder, whichever is later. */
function lastPushAt(row: CerberusRedAlertRow): number {
  return Math.max(row.notified_at, row.last_reminder_at ?? 0);
}

export function planRedWatch({ overview, open, lastClosed, clockOffsetMs }: RedWatchInputs): RedWatchPlan {
  const { now } = overview;
  const links = new Map(overview.nodes.map((node) => [node.id, node.link]));
  const fleet = new Map<string, CerberusCheckView>();
  for (const node of overview.nodes) {
    for (const service of node.services) {
      for (const check of service.checks) fleet.set(`${check.node}/${check.key}`, check);
    }
  }

  // When a check's current status began, on center's clock; null when ingest does not know.
  const beganAt = (check: CerberusCheckView): number | null =>
    check.since === null ? null : check.since + clockOffsetMs(check.node);

  const candidates = new Map<string, { check: CerberusCheckView; redSince: number }>();
  for (const { check } of overview.needsYou) {
    const redSince = beganAt(check);
    if (!PAGING_STATUSES.has(check.status) || check.mute !== null || redSince === null) continue;
    if (links.get(check.node) !== 'reporting' || now - redSince < RED_AFTER_MS) continue;
    candidates.set(`${check.node}/${check.key}`, { check, redSince });
  }

  const plan: RedWatchPlan = { opens: [], reminders: [], recoveries: [], closes: [] };
  const openKeys = new Set(open.map((row) => `${row.node}/${row.key}`));

  for (const row of open) {
    const slot = `${row.node}/${row.key}`;
    const check = fleet.get(slot);
    const link = links.get(row.node);
    if (!check || link === 'silent' || link === 'never') {
      plan.closes.push({ id: row.id, by: 'gone' });
    } else if (check.mute !== null) {
      plan.closes.push({ id: row.id, by: 'mute' });
    } else if (check.status === 'ok') {
      // It has been green since `since`; that moment, not this tick, ends the red the push reports.
      const greenAt = beganAt(check);
      const endedAt = greenAt === null ? now : Math.min(now, greenAt);
      plan.recoveries.push({ id: row.id, item: itemOf(check, (endedAt - row.red_since) / 60_000) });
    } else {
      const candidate = candidates.get(slot);
      if (candidate && now - lastPushAt(row) >= REMINDER_EVERY_MS) {
        plan.reminders.push({ id: row.id, item: itemOf(candidate.check, (now - candidate.redSince) / 60_000) });
      }
    }
  }

  for (const [slot, { check, redSince }] of candidates) {
    if (openKeys.has(slot)) continue;
    const previous = lastClosed(check.node, check.key);
    // Held: the same red an earlier incident was paged for, ended by a mute or a silence, still inside the cadence.
    const held =
      previous !== null &&
      previous.closed_by !== 'ok' &&
      redSince <= previous.opened_at &&
      now - lastPushAt(previous) < REMINDER_EVERY_MS;
    if (held) continue;
    plan.opens.push({ item: itemOf(check, (now - redSince) / 60_000), redSince });
  }

  return plan;
}
