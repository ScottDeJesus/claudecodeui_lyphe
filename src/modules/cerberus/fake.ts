import type {
  CerberusActivity, CerberusCell, CerberusCheckDetail, CerberusCheckView, CerberusLookup, CerberusMute,
  CerberusNodeView, CerberusOverview, CerberusResultRow, CerberusServiceView, CerberusStatus, CerberusStoredStatus,
} from '@/shared/cerberus-types';

/*
 * FAKE CERBERUS DATA for the fixtures that photograph the tab's pieces before their fills land. The
 * scaffolds after this one draw from it. Nothing in the app imports it.
 *
 * It is the spec's own story: 3 October 2026 at 17:52:10, the minute the shadow connector's
 * XactAnalysis session expired on eis1. Every status appears both as a CHECK's status (glyphs, pills,
 * cells) and as a SERVICE's folded one (squares, the service row's pill), and the services hold each
 * service-row sentence:
 * - one bad check: shadow-connector;
 * - two needing you: docstore;
 * - passing but for a mute: mailer;
 * - all switched off: photo-sync;
 * - all passing: restic;
 * - its one check passing: caddy.
 * The nodes: nas passes whole; eis2 is silent, so its checks read "no result"; office-mini is paused
 * for a warden update; node-5 waits for its first heartbeat. `fakeCheckDetail`'s 60 cells hold every
 * status, `fakeLookups` an answer of each verdict, and `fakeActivity` the story's whole feed.
 * Cerberus's `disk.free` and docstore's checks have no label. The rest follows the read model
 * (`server/modules/cerberus/read-model/`): its folds, counts and strips, checks in key order, nodes
 * hub-first then by enrolment, and the feed as `activity.ts` reads it.
 *
 * Every moment is LOCAL time on that day, so the clock face reads 17:52 on any machine.
 */

/** A moment on the fixture's day, local time. */
const on = (hours: number, minutes: number, seconds = 0): number => new Date(2026, 9, 3, hours, minutes, seconds).getTime();

/** The moment the fake fleet stands at: 17:52:10. */
export const fakeNow = on(17, 52, 10);

/** How bad each word is, the read model's `SEV`: a fold keeps the worse word, and not enabled never outranks a real one. */
const SEVERITY: Record<CerberusStatus, number> = { not_enabled: -1, ok: 0, paused: 1, muted: 1, unknown: 2, warn: 3, failing: 4, denied: 5 };

const STORED: ReadonlySet<CerberusStatus> = new Set(['ok', 'warn', 'failing', 'denied']);

/** The words that need a person: warn, failing, denied. */
const needsAttention = (status: CerberusStatus): boolean => SEVERITY[status] >= SEVERITY.warn;

/** A mute the operator set on one of eis1's checks; `liftedAt` stays null unless it was lifted early. */
const mute = (id: string, check: string, from: number, until: number, reason: string, liftedAt: number | null = null): CerberusMute =>
  ({ id, node: 'eis1', check, from, until, reason, by: 'lyphe', liftedAt });

const SESSION_EXPIRED = '401 from XactAnalysis — session expired';
const SESSION = 'shadow-connector/session.valid';
const BACKLOG = 'shadow-connector/imports.backlog';

/** The mute that quiets the import backlog: set at 17:40 for an hour. */
const importsMute = mute('mute-imports-1740', BACKLOG, on(17, 40), on(18, 40), 'Expected while the failed imports are retried');
/** A mute on the session itself, set at 17:35 and lifted early at 17:41: what "muted then" quotes. */
const sessionMute = mute('mute-session-1735', SESSION, on(17, 35), on(18, 35), 'Refreshing the XactAnalysis profile by hand', on(17, 41));
/** The mute that quiets the mailer's queue through the nightly send, set at 16:55. */
const mailerMute = mute('mute-mailer-1655', 'mailer/queue.age', on(16, 55), on(18, 55), 'Expected while the nightly newsletter sends');

/** One check as the read model shows it. Defaults: a health-document component, every 30 s, stale after 90 s, read 10 s ago. */
function check(node: string, key: string, status: CerberusStatus, value: string | null, extra: Partial<CerberusCheckView> = {}): CerberusCheckView {
  const slash = key.indexOf('/');
  const self = node === 'center';
  return {
    node, key, service: key.slice(0, slash), id: key.slice(slash + 1), label: null, serviceLabel: null,
    status, stored: STORED.has(status) ? (status as CerberusStoredStatus) : null, value,
    at: on(17, 52), since: on(9, 0), every: 30, staleAfter: 90,
    origin: self ? 'self' : 'component', kind: self ? 'self' : 'health_doc', mute: null,
    ...extra,
  };
}

/** A strip from runs of `[status, minutes, worst check]`, oldest first, ending with the minute that holds 17:52:10. */
function strip(runs: [CerberusStatus, number, string?][]): CerberusCell[] {
  const statuses = runs.flatMap(([status, minutes, worst]) => Array.from({ length: minutes }, () => ({ status, worst: worst ?? null })));
  const firstFrom = on(17, 52) - (statuses.length - 1) * 60_000;
  return statuses.map((cell, index) => ({ from: firstFrom + index * 60_000, to: firstFrom + (index + 1) * 60_000, ...cell }));
}

/** One service, its status folded from its checks and its counts added up the way the read model does. */
function service(node: string, name: string, label: string | null, checks: CerberusCheckView[], cells: CerberusCell[]): CerberusServiceView {
  const count = (matches: (status: CerberusStatus) => boolean) => checks.filter((entry) => matches(entry.status)).length;
  const notEnabled = count((status) => status === 'not_enabled');
  return {
    node, service: name, label, cells,
    status: checks.reduce<CerberusStatus>((folded, entry) => (SEVERITY[entry.status] > SEVERITY[folded] ? entry.status : folded), 'not_enabled'),
    checks: checks.map((entry) => ({ ...entry, serviceLabel: label })),
    counts: {
      total: checks.length - notEnabled, passing: count((status) => status === 'ok'), needsYou: count(needsAttention),
      muted: count((status) => status === 'muted'), notEnabled, unknown: count((status) => status === 'unknown'),
    },
  };
}

/** The check every sheet fixture opens: the shadow connector's session, failing since 17:52:00. */
const sessionCheck = check('eis1', SESSION, 'failing', SESSION_EXPIRED, { label: 'Session is valid', since: on(17, 52) });

// Each service lists its checks in key order, as the store hands them out (`ORDER BY service, key`). A
// folded minute names the first of them to reach its worst word, so at 17:40, when the session and the
// import backlog are both muted, the backlog names it.
const shadowConnector = service('eis1', 'shadow-connector', 'Shadow connector', [
  check('eis1', 'shadow-connector/feature.photos', 'not_enabled', 'Switched off in this service’s settings', { label: 'Photo import' }),
  check('eis1', BACKLOG, 'muted', '14 imports waiting to be retried', {
    label: 'Import backlog is clear', stored: 'failing', since: on(17, 40), mute: importsMute,
  }),
  check('eis1', 'shadow-connector/proc.up', 'ok', 'Running · up 6 days', { label: 'Process is up' }),
  sessionCheck,
  check('eis1', 'shadow-connector/sync.age', 'ok', 'Last sync 2 min ago', { label: 'Synced recently' }),
], strip([['unknown', 2, SESSION], ['ok', 6], ['denied', 1, SESSION], ['failing', 3, SESSION], ['muted', 5, SESSION],
  ['muted', 8, BACKLOG], ['warn', 4, SESSION], ['failing', 1, SESSION]]));

const supabase = service('eis1', 'supabase', 'Supabase', [
  check('eis1', 'supabase/backup.age', 'warn', 'Last backup 25 h ago', {
    label: 'Backed up in the last day', since: on(17, 44), origin: 'probe', kind: 'file_age', every: 300, staleAfter: 900,
  }),
  check('eis1', 'supabase/db.up', 'ok', 'Answered in 12 ms', { label: 'Database answers' }),
], strip([['ok', 21], ['warn', 9, 'supabase/backup.age']]));

// Two checks need you here ("2 checks need you"). The queue went warn at 16:30, before "What happened"
// reaches, so it has no line there.
const docstore = service('eis1', 'docstore', null, [
  check('eis1', 'docstore/bucket.access', 'denied', '403 from the backup bucket — credential refused', { since: on(17, 31), origin: 'probe', kind: 'exec' }),
  check('eis1', 'docstore/index.fresh', 'ok', 'Indexed 4 min ago'),
  check('eis1', 'docstore/queue.depth', 'warn', '212 documents waiting to be indexed', { since: on(16, 30) }),
], strip([['warn', 8, 'docstore/queue.depth'], ['denied', 22, 'docstore/bucket.access']]));

// Passing apart from one muted check, so the service folds to `muted` ("2 of 3 passing · 1 muted").
const mailer = service('eis1', 'mailer', 'Mailer', [
  check('eis1', 'mailer/bounce.rate', 'ok', '0.4% bounced in the last hour', { label: 'Bounces are low' }),
  check('eis1', 'mailer/queue.age', 'muted', 'Oldest message 18 min old', {
    label: 'Queue drains', stored: 'warn', since: on(16, 58), mute: mailerMute,
  }),
  check('eis1', 'mailer/smtp.up', 'ok', 'Answered in 31 ms', { label: 'SMTP answers' }),
], strip([['muted', 30, 'mailer/queue.age']]));

// Every check switched off on the service's side, so the service folds to `not_enabled`.
const photoSync = service('eis1', 'photo-sync', 'Photo sync', [
  check('eis1', 'photo-sync/thumbnails', 'not_enabled', 'Switched off in this service’s settings', { label: 'Thumbnails are made' }),
  check('eis1', 'photo-sync/uploads', 'not_enabled', 'Switched off in this service’s settings', { label: 'Uploads go through' }),
], strip([['not_enabled', 30]]));

// A window that holds the row at a check's `since` is already that word, so a strip turns at the minute
// of `since` itself (17:44 here, 17:47 below), not the minute after it.
const cerberusSelf = service('center', 'cerberus', 'Cerberus', [
  check('center', 'cerberus/disk.free', 'warn', 'Disk 84% full on /var', { since: on(17, 47) }),
  check('center', 'cerberus/gateway.listening', 'ok', 'Listening on 0.0.0.0:7443', { label: 'Warden gateway is listening' }),
  check('center', 'cerberus/store.writable', 'ok', 'Wrote a result 2 s ago', { label: 'Results store is writable' }),
], strip([['ok', 24], ['warn', 6, 'cerberus/disk.free']]));

// eis2 went quiet after 17:40, so its checks are read at 17:40 with the last values they reported.
const n8n = service('eis2', 'n8n', 'n8n', [
  check('eis2', 'n8n/queue.depth', 'unknown', '3 jobs waiting', { label: 'Queue is short', stored: 'ok', at: on(17, 40), since: on(17, 41, 30) }),
  check('eis2', 'n8n/workflow.runs', 'unknown', 'Ran 4 workflows in the last 10 min', {
    label: 'Workflows run', stored: 'ok', at: on(17, 40), since: on(17, 41, 30),
  }),
], strip([['ok', 18], ['unknown', 12, 'n8n/queue.depth']]));

const cloudcli = service('office-mini', 'cloudcli', 'CloudCLI', [
  check('office-mini', 'cloudcli/http.up', 'paused', 'Answered 200 in 40 ms', { label: 'Answers on :3011', stored: 'ok', since: on(17, 50) }),
], strip([['ok', 27], ['paused', 3, 'cloudcli/http.up']]));

// The healthy node, nas: a single-check service ("Its check is passing") and a multi-check one ("All 3
// checks passing"). It enrolled at 10:15, so its checks have passed since 10:20, not since 09:00.
const nasProbe = { origin: 'probe', since: on(10, 20) } as const;
const caddy = service('nas', 'caddy', 'Caddy', [
  check('nas', 'caddy/https.up', 'ok', 'Answered 200 in 18 ms', { label: 'Answers on :443', ...nasProbe, kind: 'http' }),
], strip([['ok', 30]]));

const restic = service('nas', 'restic', 'Backups', [
  check('nas', 'restic/disk.free', 'ok', '61% free', { label: 'Backup disk has room', ...nasProbe, kind: 'exec' }),
  check('nas', 'restic/repo.check', 'ok', 'Checked 6 h ago · no errors', { label: 'Repository checks out', ...nasProbe, kind: 'exec' }),
  check('nas', 'restic/snapshot.age', 'ok', 'Last snapshot 2 h ago', {
    label: 'Snapshot in the last day', ...nasProbe, kind: 'file_age', every: 300, staleAfter: 900,
  }),
], strip([['ok', 30]]));

/** The session as the fleet reads it: the folded copy, which carries its service's label. */
const sessionView = shadowConnector.checks.find((entry) => entry.key === SESSION) ?? sessionCheck;

const nodes: CerberusNodeView[] = [
  { id: 'center', desc: null, role: 'hub', link: 'reporting', wardenVersion: null, lastHeardAt: on(17, 52, 8), silentSince: null, enrolledAt: null, services: [cerberusSelf] },
  { id: 'eis1', desc: 'EIS application server', role: 'node', link: 'reporting', wardenVersion: '0.4.2', lastHeardAt: on(17, 52, 7), silentSince: null, enrolledAt: on(9, 0), services: [docstore, mailer, photoSync, shadowConnector, supabase] },
  { id: 'eis2', desc: 'Automation box', role: 'node', link: 'silent', wardenVersion: '0.4.1', lastHeardAt: on(17, 40), silentSince: on(17, 41, 30), enrolledAt: on(9, 5), services: [n8n] },
  { id: 'nas', desc: 'Office NAS', role: 'node', link: 'reporting', wardenVersion: '0.4.2', lastHeardAt: on(17, 52, 4), silentSince: null, enrolledAt: on(10, 15), services: [caddy, restic] },
  { id: 'office-mini', desc: 'Office mini PC', role: 'node', link: 'reporting', wardenVersion: '0.4.2', lastHeardAt: on(17, 52, 1), silentSince: null, enrolledAt: on(11, 20), services: [cloudcli] },
  { id: 'node-5', desc: null, role: 'node', link: 'never', wardenVersion: null, lastHeardAt: null, silentSince: null, enrolledAt: on(17, 5), services: [] },
];

const services = nodes.flatMap((node) => node.services);
const checks = services.flatMap((entry) => entry.checks);
const sum = (pick: (entry: CerberusServiceView) => number) => services.reduce((total, entry) => total + pick(entry), 0);

/** The session's change rows of the last 3 h, newest first: fifteen, so "Show 3 more" shows. */
const recent: CerberusResultRow[] = ([
  [17, 52, 'failing', SESSION_EXPIRED],
  [17, 48, 'warn', 'Session expires in 4 min'],
  [17, 41, 'ok', 'Session valid · refreshed by hand'],
  [17, 35, 'failing', 'Session refresh timed out.'],
  [17, 32, 'failing', 'Session refresh timed out'],
  [17, 31, 'denied', '403 from XactAnalysis — credential refused'],
  [17, 25, 'ok', 'Session valid · expires in 27 min'],
  [17, 16, 'ok', 'Session valid · expires in 36 min'],
  [17, 13, null, 'Switched off in this service’s settings'],
  [17, 3, 'ok', 'Session valid · expires in 49 min'],
  [16, 12, 'ok', 'Session valid · expires in 1 h 40 min'],
  [15, 40, 'warn', 'Session expires in 5 min'],
  [15, 34, 'ok', 'Session refreshed · expires in 2 h'],
  [15, 20, 'failing', 'Session refresh timed out'],
  [15, 5, 'ok', null],
] as const).map(([hours, minutes, status, value]) => ({ at: on(hours, minutes), status, value }));

// "WHAT HAPPENED", read as `activity.ts` reads the store: a line per stored change row whose status differs
// from the row before it, per mute event and per enrolment. A silence or a pause stores nothing, so writes none.

/** A check's plain names as a line carries them, read off the active checks. */
const namesOf = (node: string, key: string) => {
  const found = checks.find((entry) => entry.node === node && entry.key === key);
  return { label: found?.label ?? null, serviceLabel: found?.serviceLabel ?? null };
};

/** One check line: a stored change row that moved a check from one word to another. */
const moved = (node: string, key: string, at: number, from: CerberusStatus, to: CerberusStatus, value: string | null): CerberusActivity =>
  ({ kind: 'check', at, node, check: key, ...namesOf(node, key), from, to, value });

/** A mute's events: set, then lifted early or run out unlifted. */
const muteLines = (entry: CerberusMute): CerberusActivity[] => {
  const line = (at: number, event: 'muted' | 'lifted' | 'expired'): CerberusActivity => ({
    kind: 'mute', at, node: entry.node, check: entry.check, ...namesOf(entry.node, entry.check), event, until: entry.until, reason: entry.reason, by: entry.by,
  });
  const ended = entry.liftedAt !== null ? [line(entry.liftedAt, 'lifted')] : entry.until <= fakeNow ? [line(entry.until, 'expired')] : [];
  return [line(entry.from, 'muted'), ...ended];
};

/** `activity.ts`'s order: newest first, and at one instant by node, then check, then kind. */
const keyOf = (line: CerberusActivity) => `${line.node}\u0000${'check' in line ? line.check : ''}\u0000${line.kind}`;
const newestFirst = (a: CerberusActivity, b: CerberusActivity) => b.at - a.at || (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0);

/** The story's whole feed, newest first: History's, reaching what the overview's seven don't (17:31's refused move, node-5's enrolment). */
export const fakeActivity: CerberusActivity[] = [
  ...recent.flatMap((row, index) => {
    const earlier = recent[index + 1];
    return earlier === undefined || earlier.status === row.status
      ? [] : [moved('eis1', SESSION, row.at, earlier.status ?? 'not_enabled', row.status ?? 'not_enabled', row.value)];
  }),
  moved('center', 'cerberus/disk.free', on(17, 47), 'ok', 'warn', 'Disk 84% full on /var'),
  moved('eis1', 'supabase/backup.age', on(17, 44), 'ok', 'warn', 'Last backup 25 h ago'),
  moved('eis1', BACKLOG, on(17, 40), 'ok', 'failing', '14 imports waiting to be retried'),
  moved('eis1', 'docstore/bucket.access', on(17, 31), 'ok', 'denied', '403 from the backup bucket — credential refused'),
  moved('eis1', 'mailer/queue.age', on(16, 58), 'ok', 'warn', 'Oldest message 11 min old'),
  moved('eis1', 'docstore/queue.depth', on(16, 30), 'ok', 'warn', '140 documents waiting to be indexed'),
  ...[importsMute, sessionMute, mailerMute].flatMap(muteLines),
  ...nodes.flatMap((node): CerberusActivity[] => (node.enrolledAt === null ? []
    : [{ kind: 'node', at: node.enrolledAt, node: node.id, event: 'enrolled', wardenVersion: node.wardenVersion }])),
].sort(newestFirst);

/** The whole fake fleet, as `GET /api/cerberus/overview` would answer it at 17:52:10. */
export const fakeOverview: CerberusOverview = {
  now: fakeNow,
  nodes,
  needsYou: checks
    .filter((entry) => needsAttention(entry.status))
    .sort((a, b) => (a.since ?? 0) - (b.since ?? 0) || a.key.localeCompare(b.key))
    .map((entry) => ({ check: entry })),
  muted: checks.filter((entry) => entry.mute !== null),
  counts: {
    checks: sum((entry) => entry.counts.total), passing: sum((entry) => entry.counts.passing),
    needsYou: sum((entry) => entry.counts.needsYou), muted: sum((entry) => entry.counts.muted), nodes: nodes.length,
  },
  // `activity()` runs on to the end of the seventh line's instant, and `overview.ts` keeps seven of that.
  activity: fakeActivity.slice(0, 7),
  lastResultAt: on(17, 52, 8),
  gateway: { listening: true, address: '0.0.0.0:7443' },
};

const sessionLookup = (fields: Partial<CerberusLookup> & Pick<CerberusLookup, 'at' | 'verdict'>): CerberusLookup => ({
  node: 'eis1', check: sessionCheck.key, status: null, value: null, resultAt: null, mute: null, ...fields,
});

/** One answer of each verdict for the session check, and a result read while a mute covered it. */
export const fakeLookups = {
  result: sessionLookup({ at: fakeNow, verdict: 'result', status: 'failing', value: SESSION_EXPIRED, resultAt: on(17, 52) }),
  resultMuted: sessionLookup({ at: on(17, 37, 30), verdict: 'result', status: 'muted', value: 'Session refresh timed out.', resultAt: on(17, 35), mute: sessionMute }),
  stale: sessionLookup({ at: on(17, 23, 40), verdict: 'stale', status: 'unknown', resultAt: on(17, 16) }),
  tooEarly: sessionLookup({ at: on(3, 10), verdict: 'too_early' }),
  future: sessionLookup({ at: on(18, 30), verdict: 'future' }),
} satisfies Record<string, CerberusLookup>;

/** The session check's sheet as `GET /api/cerberus/checks/eis1/shadow-connector/session.valid` would answer it: 60 cells holding every status. */
export const fakeCheckDetail: CerberusCheckDetail = {
  check: sessionView,
  siblings: shadowConnector.checks.filter((entry) => entry.key !== sessionView.key),
  cells: strip([
    ['ok', 8], ['paused', 2], ['ok', 10], ['not_enabled', 3], ['ok', 7], ['unknown', 2], ['ok', 6],
    ['denied', 1], ['failing', 3], ['muted', 6], ['ok', 7], ['warn', 4], ['failing', 1],
  ]),
  recent,
  lookup: fakeLookups.result,
};
