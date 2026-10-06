// One mapping from the read model's "What happened" lines to the kit's `Timeline` rows, so the
// Fleet's seven-line card and History's long feed can never word the same event two ways. The words
// are keys under `cerberus.activity` in `en/common.json`; a label, a reason, a node name and a value
// are the data's own and go in as variables, never as keys.
import type { TFunction } from 'i18next';

import { STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { dayAndTime, hm, hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusActivity, CerberusStatus } from '@/shared/cerberus-types';
import type { TimelineEvent } from '@/shared/types';

type CheckActivity = Extract<CerberusActivity, { kind: 'check' }>;
type MuteActivity = Extract<CerberusActivity, { kind: 'mute' }>;
type NodeActivity = Extract<CerberusActivity, { kind: 'node' }>;

/** A status as the word the tab shows for it ("Close to the limit"), from the one status table. */
function statusWord(t: TFunction, status: CerberusStatus): string {
  return t(STATUS_TABLE[status].wordKey);
}

/** The service a check key (`<service>/<id>`) belongs to: everything before its first `/`. */
function serviceOfKey(checkKey: string): string {
  const slash = checkKey.indexOf('/');
  return slash === -1 ? checkKey : checkKey.slice(0, slash);
}

/** True when two moments fall on the same local calendar day. */
function sameLocalDay(first: number, second: number): boolean {
  const a = new Date(first);
  const b = new Date(second);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The words a check can move to that have a sentence of their own under `cerberus.activity.check`. */
function hasOwnSentence(status: CerberusStatus): status is 'ok' | 'warn' | 'failing' | 'unknown' {
  return status === 'ok' || status === 'warn' || status === 'failing' || status === 'unknown';
}

/**
 * "<label> is failing" / "passes again" / "is close to the limit" / "has no result", and for any
 * other word the check moved to, "<label> is <word>" ("is refused", "is muted"). The summary is the
 * value the check reported, when it reported one.
 */
function checkEvent(activity: CheckActivity, t: TFunction, when: string): TimelineEvent {
  const label = activity.label ?? activity.check;
  const title = hasOwnSentence(activity.to)
    ? t(`cerberus.activity.check.${activity.to}`, { label })
    : t('cerberus.activity.check.other', { label, word: statusWord(t, activity.to).toLowerCase() });
  const movement = `${statusWord(t, activity.from)} → ${statusWord(t, activity.to)}`;
  return {
    tone: STATUS_TABLE[activity.to].tone,
    source: activity.serviceLabel ?? serviceOfKey(activity.check),
    title,
    ...(activity.value ? { summary: activity.value } : {}),
    when,
    meta: `${t('cerberus.activity.meta', { service: activity.check, node: activity.node })} · ${movement}`,
  };
}

/**
 * The title of a mute that was set: "<label> muted until HH:MM", and "… HH:MM tomorrow" when the lift
 * falls on a later local day than the mute — a mute is capped at 24 h, so a different day is always
 * the next one, and a bare 08:00 under a 17:52 row would otherwise read as already past.
 */
function mutedTitle(activity: MuteActivity, label: string, t: TFunction): string {
  const key = sameLocalDay(activity.at, activity.until) ? 'cerberus.activity.muted' : 'cerberus.activity.mutedTomorrow';
  return t(key, { label, time: hm(activity.until) });
}

/**
 * "<label> muted until HH:MM" with the person's reason under it; a lift early is "Mute lifted ·
 * <label>", and one that ran out on its own is the same line with "It expired on its own" under it.
 * A mute moves no status, so every mute line is neutral.
 */
function muteEvent(activity: MuteActivity, t: TFunction, when: string): TimelineEvent {
  const label = activity.label ?? activity.check;
  const summary = activity.event === 'muted'
    ? activity.reason
    : activity.event === 'expired' ? t('cerberus.activity.expired') : '';
  return {
    tone: 'neutral',
    source: activity.serviceLabel ?? serviceOfKey(activity.check),
    title: activity.event === 'muted'
      ? mutedTitle(activity, label, t)
      : t('cerberus.activity.lifted', { label }),
    ...(summary ? { summary } : {}),
    when,
    meta: t('cerberus.activity.meta', { service: activity.check, node: activity.node }),
  };
}

/** "<node> enrolled", with the warden's version under it when the warden has said hello. */
function nodeEvent(activity: NodeActivity, t: TFunction, when: string): TimelineEvent {
  return {
    tone: 'positive',
    source: t('cerberus.activity.source.node'),
    title: t('cerberus.activity.enrolled', { node: activity.node }),
    ...(activity.wardenVersion ? { summary: t('cerberus.activity.enrolledSummary', { version: activity.wardenVersion }) } : {}),
    when,
  };
}

/**
 * One "What happened" line as a Timeline row. Used by the Fleet's What happened card (the overview's
 * newest seven) and by History's feed (pages of `GET /api/cerberus/activity`).
 *
 * `when` is the clock time to the second for a moment on `now`'s own day, and the date with the
 * minute for any other — a bare "17:52:10" under "Everything since…" would read as today's when it
 * is not. `now` is the caller's, not the clock's, so a row never changes between two renders of the
 * same overview.
 *
 * LATER PLANS ADD THEIR KINDS HERE. The union `CerberusActivity` gains `fix`, `catalog`, `diagnosis`
 * and `warden` as those plans land; each adds its case to this switch, its builder above, and its
 * words under `cerberus.activity`. Until a plan does, a kind this bundle does not know — a newer
 * server's line in an older tab — is shown as a neutral row naming the kind, never thrown on: a
 * screen must not go blank over one line it has no words for.
 */
export function toTimelineEvent(activity: CerberusActivity, t: TFunction, now: number): TimelineEvent {
  const when = sameLocalDay(activity.at, now) ? hms(activity.at) : dayAndTime(activity.at);
  switch (activity.kind) {
    case 'check':
      return checkEvent(activity, t, when);
    case 'mute':
      return muteEvent(activity, t, when);
    case 'node':
      return nodeEvent(activity, t, when);
    default: {
      const unlearned: { kind: string } = activity;
      return { tone: 'neutral', source: unlearned.kind, title: unlearned.kind, when };
    }
  }
}
