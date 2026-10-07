// One mapping from the read model's "What happened" lines to the kit's `Timeline` rows, so the
// Fleet's seven-line card and History's long feed can never word the same event two ways. The words
// are keys under `cerberus.activity` in `en/common.json`; a label, a reason, a node name and a value
// are the data's own and go in as variables, never as keys.
import type { TFunction } from 'i18next';

import { RUN_LOOK, STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { dayAndTime, hm, hms, sameLocalDay } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusActivity, CerberusStatus } from '@/shared/cerberus-types';
import type { TimelineEvent } from '@/shared/types';

type CheckActivity = Extract<CerberusActivity, { kind: 'check' }>;
type MuteActivity = Extract<CerberusActivity, { kind: 'mute' }>;
type NodeActivity = Extract<CerberusActivity, { kind: 'node' }>;
type FixActivity = Extract<CerberusActivity, { kind: 'fix' }>;
type CatalogActivity = Extract<CerberusActivity, { kind: 'catalog' }>;
type WardenActivity = Extract<CerberusActivity, { kind: 'warden' }>;
type DiagnosisActivity = Extract<CerberusActivity, { kind: 'diagnosis' }>;

/** A status as the word the tab shows for it ("Close to the limit"), from the one status table. */
function statusWord(t: TFunction, status: CerberusStatus): string {
  return t(STATUS_TABLE[status].wordKey);
}

/** The service a check key (`<service>/<id>`) belongs to: everything before its first `/`. */
function serviceOfKey(checkKey: string): string {
  const slash = checkKey.indexOf('/');
  return slash === -1 ? checkKey : checkKey.slice(0, slash);
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
 * A fix's run, at its two moments. As it starts: "Ran on its own: “X”" or "You ran “X”", in a going run's
 * info tone. As it ends: "“X” finished · Succeeded in 12 s", "· Failed" or "· Timed out", in the result's
 * tone (`RUN_LOOK`), or "The warden refused “X”" in the refusal's red. The feed's line carries the
 * result and the seconds, not the exit code, so a failure reads "Failed"; the run's own strip and Fix
 * output say "exit 1".
 */
function fixEvent(activity: FixActivity, t: TFunction, when: string): TimelineEvent {
  const { name, result } = activity;
  const base = {
    source: t('cerberus.activity.source.fix'),
    when,
    meta: t('cerberus.activity.meta', { service: activity.check, node: activity.node }),
  };
  if (activity.event === 'started' || result === null) {
    return {
      ...base,
      tone: RUN_LOOK.going.tone,
      title: t(activity.by === 'auto' ? 'cerberus.activity.fix.ranAuto' : 'cerberus.activity.fix.ranYou', { name }),
    };
  }
  if (result === 'refused') return { ...base, tone: RUN_LOOK.refused.tone, title: t('cerberus.activity.fix.refused', { name }) };
  const outcome = result === 'ok'
    ? activity.durationS === null ? t('cerberus.fix.output.ok') : t('cerberus.activity.fix.succeeded', { count: activity.durationS })
    : result === 'timed_out' ? t('cerberus.activity.fix.timedOut') : t('cerberus.activity.fix.failed');
  return { ...base, tone: RUN_LOOK[result].tone, title: t('cerberus.activity.fix.finished', { name, result: outcome }) };
}

/** A catalog entry added (positive) or its auto-run switched on or off (neutral): "Added “X”", "Auto-run on · “X”", "Auto-run off · “X”". */
function catalogEvent(activity: CatalogActivity, t: TFunction, when: string): TimelineEvent {
  const { name } = activity;
  const title = {
    added: t('cerberus.activity.catalog.added', { name }),
    auto_on: t('cerberus.activity.catalog.autoOn', { name }),
    auto_off: t('cerberus.activity.catalog.autoOff', { name }),
  }[activity.event];
  return { tone: activity.event === 'added' ? 'positive' : 'neutral', source: t('cerberus.activity.source.catalog'), title, when };
}

/**
 * A warden update, at its moments. As a batch starts (no node: it is about all it names): "You started a
 * warden update to 0.4.3" in the info tone, with "2 nodes · one at a time" under it. As one node's update ends:
 * "Warden on eis1 updated to 0.4.3 · 0.4.2 kept for rollback" (positive; the tail is left out when the node had
 * reported no version or was already on the release), "Warden on eis1 rolled back to 0.4.2" (warn: the launcher took the new release back,
 * so `from` is the version it is on again) or "Warden on eis1 could not update to 0.4.3" (warn: the warden gave
 * up, or went quiet for three minutes).
 */
function wardenEvent(activity: WardenActivity, t: TFunction, when: string): TimelineEvent {
  const { node, from, to } = activity;
  const base = { source: t('cerberus.activity.source.warden'), when };
  const named = node ?? '';
  switch (activity.event) {
    case 'update_started':
      return {
        ...base,
        tone: 'info',
        title: t('cerberus.activity.warden.started', { to }),
        ...(activity.nodes === undefined ? {} : { summary: t('cerberus.activity.warden.startedSummary', { count: activity.nodes }) }),
      };
    case 'updated':
      return {
        ...base,
        tone: 'positive',
        // Nothing was kept for rollback when the node reported no version, or was already on the release (the
        // offer ended "Already on <v>", no swap): `from === to`.
        title: from === null || from === to
          ? t('cerberus.activity.warden.updated', { node: named, to })
          : t('cerberus.activity.warden.updatedKept', { node: named, to, from }),
      };
    case 'rolled_back':
      return {
        ...base,
        tone: 'warn',
        title: from === null
          ? t('cerberus.activity.warden.rolledBackUnknown', { node: named })
          : t('cerberus.activity.warden.rolledBack', { node: named, from }),
      };
    case 'update_failed':
      return { ...base, tone: 'warn', title: t('cerberus.activity.warden.failed', { node: named, to }) };
  }
}

/**
 * A diagnosis, at its moments. As it is asked: "You asked for a diagnosis" in a going run's info tone, with
 * "<label> · read-only" under it. As it ends: "Diagnosis ready" with its summary under it (neutral: a diagnosis is
 * a document, not a health signal, as its pill in the sheet is), or "Diagnosis failed" with the sentence that
 * says why under it (the warn of a failed run). A check with no label is named by its key.
 */
function diagnosisEvent(activity: DiagnosisActivity, t: TFunction, when: string): TimelineEvent {
  const base = {
    source: t('cerberus.activity.source.diagnosis'),
    when,
    meta: t('cerberus.activity.meta', { service: activity.check, node: activity.node }),
  };
  if (activity.event === 'asked') {
    return {
      ...base,
      tone: RUN_LOOK.going.tone,
      title: t('cerberus.activity.diagnosis.asked'),
      summary: t('cerberus.activity.diagnosis.askedSummary', { label: activity.label ?? activity.check }),
    };
  }
  const failed = activity.event === 'failed';
  return {
    ...base,
    tone: failed ? RUN_LOOK.failed.tone : 'neutral',
    title: t(failed ? 'cerberus.activity.diagnosis.failed' : 'cerberus.activity.diagnosis.ready'),
    ...(activity.summary ? { summary: activity.summary } : {}),
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
 * A PLAN THAT ADDS A KIND ADDS ITS CASE HERE, its builder above, and its words under `cerberus.activity`. Until it
 * does, a kind this bundle does not know — a newer server's line in an older tab — is shown as a neutral row
 * naming the kind, never thrown on: a screen must not go blank over one line it has no words for.
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
    case 'fix':
      return fixEvent(activity, t, when);
    case 'catalog':
      return catalogEvent(activity, t, when);
    case 'warden':
      return wardenEvent(activity, t, when);
    case 'diagnosis':
      return diagnosisEvent(activity, t, when);
    default: {
      const unlearned: { kind: string } = activity;
      return { tone: 'neutral', source: unlearned.kind, title: unlearned.kind, when };
    }
  }
}
