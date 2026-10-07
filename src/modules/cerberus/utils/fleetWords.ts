// The sentences the Fleet view says about a node and a service: the one line under a node's name, its
// warden line, and the pill of a service row. They live in one file because a node card, a service row
// and the rings' panel each say them, and a service's sentence is also the name of its square in a
// collapsed card. Every word is a key in `en/common.json` under `cerberus`; a label, a node name and a
// version are the data's own and go in as variables, never as keys. Like `activityEvents.ts`, it takes
// `t` and the moment `now` from its caller, so a sentence is a function of what it is handed.
import type { TFunction } from 'i18next';

import { STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { agoParts, hm } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusNodeView, CerberusServiceView, CerberusStatus } from '@/shared/cerberus-types';
import type { FleetItem } from '@/shared/types';

/** The words a check needs a person for: the three the read model counts in `needsYou`. */
const NEEDS_A_PERSON: ReadonlySet<CerberusStatus> = new Set(['warn', 'failing', 'denied']);

/** A status's word, lowered to sit inside a sentence: "close to the limit", "refused". */
function lowerWord(t: TFunction, status: CerberusStatus): string {
  return t(STATUS_TABLE[status].wordKey).toLowerCase();
}

/**
 * "12 s ago", "4 min ago", "just now": how long before `now` a moment was. The warden line below says
 * it of a heartbeat, and the tab's header (`CerberusHeader`) of the last result center received.
 */
export function agoPhrase(t: TFunction, ms: number, now: number): string {
  const parts = agoParts(ms, now);
  if (parts === 'now') return t('cerberus.time.justNow');
  const key = { s: 'secondsAgo', min: 'minutesAgo', h: 'hoursAgo', d: 'daysAgo' }[parts.unit];
  return t(`cerberus.time.${key}`, { count: parts.n });
}

/**
 * What a service row's pill says, and the name of the service's square in a collapsed card:
 * - one check needs you: "<its label> — failing" (its key when it has no label);
 * - more: "2 checks need you";
 * - no result: "Its check has no result", "No result from its 2 checks", or "1 of 3 passing · 2 no result";
 * - paused for a warden update: "Paused while its warden restarts";
 * - passing but for a mute: "2 of 3 passing · 1 muted";
 * - every check switched off on the service's own side: the status word, "Not enabled";
 * - passing: "Its check is passing", "All 3 checks passing".
 * The service's folded status picks the case, so the pill's glyph and its words never disagree. A
 * switched-off check is in no count, as the read model has it ("never counted in “of N checks”").
 */
export function serviceSentence(t: TFunction, service: CerberusServiceView): string {
  const { counts } = service;
  switch (service.status) {
    case 'warn':
    case 'failing':
    case 'denied': {
      const needing = service.checks.filter((check) => NEEDS_A_PERSON.has(check.status));
      if (needing.length === 1) {
        const [check] = needing;
        return t('cerberus.service.oneBad', { label: check.label ?? check.key, word: lowerWord(t, check.status) });
      }
      return t('cerberus.service.needYou', { count: counts.needsYou });
    }
    case 'unknown':
      return counts.unknown === counts.total
        ? t('cerberus.service.noResult', { count: counts.unknown })
        : t('cerberus.service.someNoResult', { passing: counts.passing, total: counts.total, unknown: counts.unknown });
    case 'paused':
      return t('cerberus.service.paused');
    case 'muted':
      return t('cerberus.service.someMuted', { passing: counts.passing, total: counts.total, muted: counts.muted });
    case 'not_enabled':
      return t(STATUS_TABLE.not_enabled.wordKey);
    case 'ok':
      return t('cerberus.service.allPassing', { count: counts.total });
  }
}

/**
 * The one line under a node's name, in a collapsed card, a list row and the rings:
 * - its warden has not said hello and nothing is assigned: "Waiting for the first heartbeat";
 * - nothing assigned: "Nothing assigned yet";
 * - its warden restarting for an update: "Warden restarting";
 * - passing but for a mute: "Passing · muted check";
 * - passing: "Its service is passing", "All 3 services passing";
 * - anything worse: the first service at the node's word, and that word — "docstore — refused",
 *   "n8n — no result".
 * A switched-off service counts as passing for the node, as the fleet model folds it.
 */
export function nodeLine(t: TFunction, item: FleetItem, node: CerberusNodeView): string {
  if (node.services.length === 0) {
    return node.link === 'never' ? t('cerberus.node.waiting') : t('cerberus.node.nothingAssigned');
  }
  switch (item.status) {
    case 'paused':
      return t('cerberus.node.restarting');
    case 'muted':
      return t('cerberus.node.mutedCheck');
    case 'ok':
      return t('cerberus.node.allPassing', { count: node.services.length });
    case 'failing':
    case 'denied':
    case 'warn':
    case 'unknown': {
      const status = item.status;
      const worst = node.services.find((service) => service.status === status) ?? node.services[0];
      return t('cerberus.node.bad', { label: worst.label ?? worst.service, word: lowerWord(t, status) });
    }
    default:
      // `fixing`, `enrolling` and `empty` are the fixes and updates plans' places; nothing feeds them
      // yet, and a node with services is never `empty`. Each plan writes its own line here.
      return t('cerberus.node.nothingAssigned');
  }
}

/**
 * Whether a node's warden is restarting for an update: the read model pauses every check of the node
 * while it does (`paused`). Its heartbeat is then not a sign of life to breathe for, and its warden line
 * says so. Read by `wardenLine` and by the node card's heartbeat dot.
 */
export function isRestarting(node: CerberusNodeView): boolean {
  return node.services.some((service) => service.checks.some((check) => check.status === 'paused'));
}

/**
 * A node's warden line: "Warden 0.4.2 · heard 3 s ago" while it reports, "Warden 0.4.2 · restarting"
 * while its warden restarts for an update, "Warden 0.4.1 · silent since 17:41" once it has gone quiet
 * (silence outranks a restart: a restart that never comes back is the thing to see), "Waiting for the
 * first heartbeat" before its first, and for the hub, which has no warden, "Cerberus · this server".
 * The age is against `now`, the read's own moment: between two reads a node's heartbeats are not
 * re-read, so a clock that ran on would age a node that is still reporting. A heartbeat carries the
 * warden's version, so a node that has reported has one.
 */
export function wardenLine(t: TFunction, node: CerberusNodeView, now: number): string {
  if (node.role === 'hub') return t('cerberus.node.hub');
  if (node.link === 'never' || node.lastHeardAt === null) return t('cerberus.node.waiting');
  const version = node.wardenVersion ?? '';
  if (node.link === 'silent') {
    return t('cerberus.node.silent', { version, time: hm(node.silentSince ?? node.lastHeardAt) });
  }
  if (isRestarting(node)) return t('cerberus.node.wardenRestarting', { version });
  return t('cerberus.node.heard', { version, ago: agoPhrase(t, node.lastHeardAt, now) });
}
