import { cerberusDefinitionsDb, cerberusNodesDb, projectsDb } from '@/modules/database/index.js';
import type {
  CerberusCheckView,
  CerberusNeed,
  CerberusNodeView,
  CerberusOverview,
  CerberusReadInputs,
  CerberusServiceView,
  CerberusStatus,
} from '@/shared/cerberus-types.js';

import { HUB_NODE_ID } from '../definition-document.js';
import { nodeSessions } from '../node-sessions.js';

import { activity } from './activity.js';
import { buildServiceCells, stripStart } from './cells.js';
import { offeredFixes } from './catalog-views.js';
import { buildCheckView } from './check-views.js';
import { resolveNodeLink } from './node-links.js';
import { needRuns, runningViews } from './run-views.js';
import { loadSeries, type CheckSeries } from './series.js';
import { needsAttention, worst } from './status-rules.js';

/** The strip every service draws on the fleet screen: thirty one-minute cells. */
const OVERVIEW_CELLS = 30;

/** How many lines of "What happened" the overview carries; the activity route pages the rest. */
const OVERVIEW_ACTIVITY = 7;

/**
 * The whole fleet at `inputs.now`, as the tab reads it — and as the `fixes` plan's auto-run reads it,
 * through the same status rules. A pure function of the store's repositories and one
 * `CerberusReadInputs`, so "now" and "a minute ago" are answered by one set of rules.
 *
 * What it counts: a check is in `counts.checks` unless it is not enabled (a retired check is not in
 * the active index at all); `not_enabled` never needs you, and a muted check keeps recording, so it
 * is in `muted` and never in `needsYou`. `needsYou` lists the active checks whose current status is
 * warn, failing or denied, ordered by how long ago they began (ingest's `since`) then key; a check
 * whose beginning ingest does not know sorts after the ones it does. Each need carries the fix offered
 * for it and the run it shows (`run-views.ts`); `running` is every fix run that has not ended.
 */

/** What reading one node yields: its services, and the evidence the overview totals across nodes. */
type NodeReading = {
  services: CerberusServiceView[];
  newestResultAt: number | null;
  newestHeardAt: number | null;
};

/** The newest `at` among a series' rows that has already happened, or null. */
function newestRowAt(series: CheckSeries, now: number): number | null {
  let newest: number | null = null;
  for (const row of series.rows) {
    if (row.at <= now && (newest === null || row.at > newest)) newest = row.at;
  }
  return newest;
}

/** The larger of two moments, either of which may be missing. */
function later(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * One service's view: its checks as read now, its strip, its status folded from the checks —
 * `unknown` with no checks, and `not_enabled` when every check is — and the counts the header row
 * prints (`total` leaves out the not-enabled).
 */
function buildServiceView(
  node: string,
  service: string,
  serviceSeries: CheckSeries[],
  silentSince: number | null,
  inputs: CerberusReadInputs
): CerberusServiceView {
  const checks = serviceSeries.map((series) => buildCheckView(series, silentSince, inputs));
  const status = checks.reduce<CerberusStatus>((folded, check) => worst(folded, check.status), 'not_enabled');
  const count = (matches: (check: CerberusCheckView) => boolean): number => checks.filter(matches).length;
  const notEnabled = count((check) => check.status === 'not_enabled');

  return {
    node,
    service,
    label: serviceSeries.find((series) => series.check.service_label !== null)?.check.service_label ?? null,
    status: checks.length === 0 ? 'unknown' : status,
    checks,
    cells: buildServiceCells(serviceSeries, silentSince, inputs.now, OVERVIEW_CELLS),
    counts: {
      total: checks.length - notEnabled,
      passing: count((check) => check.status === 'ok'),
      needsYou: count((check) => needsAttention(check.status)),
      muted: count((check) => check.status === 'muted'),
      notEnabled,
      unknown: count((check) => check.status === 'unknown'),
    },
  };
}

/**
 * Reads every service of one node: those with an active check, and those a probe is defined for
 * that has found no check yet (a health document not yet fetched), which draw `unknown` cells.
 * Ordered by service name.
 */
function readNode(node: string, silentSince: number | null, inputs: CerberusReadInputs): NodeReading {
  const series = loadSeries(
    node,
    cerberusDefinitionsDb.activeChecks(node),
    stripStart(inputs.now, OVERVIEW_CELLS),
    inputs.now,
    inputs
  );
  const serviceNames = new Set([
    ...series.map((entry) => entry.check.service),
    ...cerberusDefinitionsDb.probesOf(node).map((probe) => probe.service),
  ]);

  let newestResultAt: number | null = null;
  let newestHeardAt: number | null = null;
  for (const entry of series) {
    const newest = newestRowAt(entry, inputs.now);
    newestResultAt = later(newestResultAt, newest);
    newestHeardAt = later(newestHeardAt, later(newest, entry.liveLastAt));
  }

  const services = [...serviceNames]
    .sort()
    .map((service) =>
      buildServiceView(node, service, series.filter((entry) => entry.check.service === service), silentSince, inputs)
    );
  return { services, newestResultAt, newestHeardAt };
}

/** Oldest `since` first, an unknown one last; then by key, then node, so the order is stable. */
function sinceThenKey(a: CerberusNeed, b: CerberusNeed): number {
  const sinceA = a.check.since ?? Number.POSITIVE_INFINITY;
  const sinceB = b.check.since ?? Number.POSITIVE_INFINITY;
  if (sinceA !== sinceB) return sinceA < sinceB ? -1 : 1;
  if (a.check.key !== b.check.key) return a.check.key < b.check.key ? -1 : 1;
  return a.check.node < b.check.node ? -1 : a.check.node > b.check.node ? 1 : 0;
}

/**
 * Builds the overview. Nodes come hub first — `center`, role `hub`, link `reporting`, `lastHeardAt`
 * its newest self-check, no `nodes` row, never silent — then every enrolled node with its link from
 * `inputs.links`: `reporting`, `silent`, or `never` before a first heartbeat (see
 * `resolveNodeLink`). A node's silence is laid over its cells and its checks' current statuses.
 *
 * Consumers: the overview route (`GET /overview`) and, through the cerberus barrel, the `fixes`
 * plan's auto-run.
 */
export function buildOverview(inputs: CerberusReadInputs): CerberusOverview {
  const { now } = inputs;
  const nodes: CerberusNodeView[] = [];
  let lastResultAt: number | null = null;

  const hub = readNode(HUB_NODE_ID, null, inputs);
  lastResultAt = later(lastResultAt, hub.newestResultAt);
  nodes.push({
    id: HUB_NODE_ID,
    desc: null,
    role: 'hub',
    link: 'reporting',
    wardenVersion: null,
    lastHeardAt: hub.newestHeardAt,
    silentSince: null,
    enrolledAt: null,
    // center runs no warden, so it hosts no sessions and takes no projects.
    colocated: false,
    projects: [],
    sessions: 0,
    services: hub.services,
  });

  for (const row of cerberusNodesDb.list()) {
    const state = inputs.links.get(row.id);
    const link = resolveNodeLink(row, state, now);
    const reading = readNode(row.id, link.silentSince, inputs);
    lastResultAt = later(lastResultAt, reading.newestResultAt);
    nodes.push({
      id: row.id,
      desc: row.desc,
      role: 'node',
      link: link.link,
      wardenVersion: state?.version ?? row.warden_version,
      lastHeardAt: link.lastHeardAt,
      silentSince: link.link === 'silent' ? link.silentSince : null,
      enrolledAt: row.enrolled_at,
      colocated: nodeSessions.isColocated(row.id),
      // Read from the projects table and the relay's cache, not from `inputs`: they are where the
      // fleet stands now, and neither feeds a status, so "a minute ago" never has to answer for them.
      projects: projectsDb.listByNode(row.id),
      sessions: nodeSessions.lastListed(row.id).length,
      services: reading.services,
    });
  }

  const checks = nodes.flatMap((node) => node.services.flatMap((service) => service.checks));
  const needing = checks.filter((check) => needsAttention(check.status));
  const fixes = offeredFixes(needing);
  const runs = needRuns(needing, inputs);
  const services = nodes.flatMap((node) => node.services);
  const sum = (pick: (service: CerberusServiceView) => number): number =>
    services.reduce((total, service) => total + pick(service), 0);

  return {
    now,
    nodes,
    needsYou: needing
      .map((check) => ({
        check,
        fix: fixes.get(`${check.node}/${check.key}`) ?? null,
        run: runs.get(`${check.node}/${check.key}`) ?? null,
      }))
      .sort(sinceThenKey),
    muted: checks.filter((check) => check.mute !== null),
    running: runningViews(nodes.map((node) => node.id)),
    counts: {
      checks: sum((service) => service.counts.total),
      passing: sum((service) => service.counts.passing),
      needsYou: sum((service) => service.counts.needsYou),
      muted: sum((service) => service.counts.muted),
      nodes: nodes.length,
    },
    // `before` is exclusive; one past `now` includes what happened this very millisecond.
    activity: activity({ before: now + 1, limit: OVERVIEW_ACTIVITY }, inputs).slice(0, OVERVIEW_ACTIVITY),
    lastResultAt,
    gateway: { listening: inputs.gateway.address !== null, address: inputs.gateway.address },
  };
}
