import fs from 'node:fs';

import type { UniverseMap } from '@/shared/types.js';

import { universeMergedMapPath } from './universe-state.service.js';

/**
 * The map, held.
 *
 * Reading `merged.json` is a 1.4 MB parse — cheap once, and a tax on every request if the route
 * did it, which matters because a GET of this size is exactly the one a tab reloads. So the file
 * is read when this service is built, and again only when a crawl says it landed: `reload()` is
 * asked for by the heads watcher, which is the only process that knows a new map exists.
 *
 * What this service deliberately does NOT do is merge, offset or re-index anything. The crawler
 * assigned every node index and wrote every edge over those indices, and the rule has exactly one
 * owner — the process that produced the node lists. A second assignment here would be a second
 * answer to the same question, and it would be the wrong one the moment the crawl's ordering
 * changed. This is a cache in front of a file, and a lookup table over the crawler's indices.
 */

/** An empty map, so a host whose crawl has never run still answers with a map rather than an error. */
const EMPTY_MAP: UniverseMap = {
  mapId: '',
  builtAt: 0,
  repos: [],
  nodes: [],
  edges: { tree: [], import: [], cochange: [], endpoint: [] },
  routes: [],
  loggers: {},
  tables: {},
  endpoints: [],
  attention: [],
  resolve: [],
  warnings: [],
};

export type UniverseMapService = {
  /** The held map. Never a disk read — the whole point of holding it. */
  currentMap(): UniverseMap;
  /** The held map's id: the first 12 hex of the four HEAD shas, so a comparison is all it is for. */
  mapId(): string;
  /** Re-reads the file and adopts it when its `mapId` differs from the held one. Returns what is held. */
  reload(): UniverseMap;
  /** The node at `<repo>/<relpath>`, or `-1` when the map has no such node. */
  nodeIndexFor(repoId: string, relpath: string): number;
  /** The node an ABSOLUTE path belongs to, or `-1`. The prefix walk lives here so no caller repeats it. */
  nodeIndexForPath(absolutePath: string): number;
  /** The node of an endpoint id — `mcp:archpulse`, `pg:eis` — or `-1`. */
  nodeIndexForEndpoint(id: string): number;
  /** The routes declared by files that live in one repo — the only candidates for that repo's own units. */
  routesForRepo(repoId: string): UniverseMap['routes'];
};

/**
 * Reads `merged.json`, or `null` when there is nothing usable there. Never throws: a missing or
 * half-written map is a state this lane reports and keeps serving from, not one it dies of.
 */
function readMergedMap(): UniverseMap | null {
  const file = universeMergedMapPath();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as UniverseMap;
    // A `mapId` and a node list are the two things every reader below assumes; a file without them
    // is a partial write, and adopting it would answer every later lookup with nonsense.
    if (typeof parsed?.mapId !== 'string' || !Array.isArray(parsed.nodes)) return null;
    return parsed;
  } catch (error) {
    console.error(`[Universe] could not read the map at ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function createUniverseMapService(): UniverseMapService {
  let held = readMergedMap() ?? EMPTY_MAP;
  /**
   * `parent index -> basename -> node index`, built on the first lookup and dropped whenever the
   * held map is replaced. Built lazily because a lane that only serves the map never needs it, and
   * held because resolving a path walks the same chains on every event a busy estate produces.
   */
  let childIndex: Map<number, Map<string, number>> | null = null;

  /**
   * `endpoint id -> node index`, built on the first lookup and dropped with the map, for the same
   * laziness reason as the child index. Endpoints are the handful of nodes appended after the file
   * nodes, and their ids are what a `mcp__<server>__<tool>` tool call names.
   */
  let endpointIndex: Map<string, number> | null = null;

  /**
   * `node index -> repo id`, built on the first call and dropped with the map. A child's index is
   * always above its parent's — the crawler flattens each tree top-down — so one forward pass over
   * `p` resolves every chain and no node costs a walk.
   */
  let ownerIndex: string[] | null = null;

  const childrenOf = (parent: number): Map<string, number> | undefined => childIndex?.get(parent);

  const buildOwnerIndex = (): string[] => {
    const repoOfBase = new Map<number, string>();
    for (const repo of held.repos) repoOfBase.set(repo.base, repo.id);
    // A node with no parent is either a repo (which owns itself) or an endpoint, which owns nothing.
    const owners = new Array<string>(held.nodes.length).fill('');
    held.nodes.forEach((node, position) => {
      owners[position] = node.p === -1 ? repoOfBase.get(position) ?? '' : owners[node.p] ?? '';
    });
    return owners;
  };

  const buildChildIndex = (): Map<number, Map<string, number>> => {
    const index = new Map<number, Map<string, number>>();
    held.nodes.forEach((node, position) => {
      if (node.p === -1) return;
      let siblings = index.get(node.p);
      if (siblings === undefined) {
        siblings = new Map<string, number>();
        index.set(node.p, siblings);
      }
      // First writer wins. Two children of one parent share a basename only in a map the crawler
      // could not have written, and its own ordering is the one to keep if it ever does.
      if (!siblings.has(node.n)) siblings.set(node.n, position);
    });
    return index;
  };

  /**
   * The node at `<repo>/<relpath>`, or `-1`. The one descent in this service: `nodeIndexFor` and
   * the absolute-path walk below both go through it, so the child index stays the only place the
   * rule is spelled.
   */
  const nodeAt = (repoId: string, relpath: string): number => {
    // The crawler already recorded where each repo's tree begins — no search, and no rule here
    // about which node is a repo's root.
    const root = held.repos.find((repo) => repo.id === repoId)?.base;
    if (root === undefined) return -1;

    const segments = relpath.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.length === 0) return root;

    if (childIndex === null) childIndex = buildChildIndex();
    let current = root;
    for (const segment of segments) {
      const child = childrenOf(current)?.get(segment);
      if (child === undefined) return -1;
      current = child;
    }
    return current;
  };

  return {
    currentMap: () => held,

    mapId: () => held.mapId,

    reload: () => {
      const next = readMergedMap();
      // Same `mapId` means the same map: the crawler's id is a hash of the four HEAD shas, so
      // keeping the held object rather than the fresh parse is not a shortcut, it is the identity.
      if (next !== null && next.mapId !== held.mapId) {
        held = next;
        childIndex = null;
        endpointIndex = null;
        ownerIndex = null;
      }
      return held;
    },

    nodeIndexFor: (repoId, relpath) => nodeAt(repoId, relpath),

    nodeIndexForPath: (absolutePath) => {
      // `resolve` is the crawler's path-to-repo rule shipped as DATA, sorted longest path first.
      // The ordering IS the rule, so it is taken as given: walk it in order and take the first
      // entry this path is under. Re-sorting here would not be a second opinion, it would be the
      // bug that puts every file of a repo nested in the sun inside the sun.
      for (const entry of held.resolve) {
        // A path is under a repo only at a segment BOUNDARY: `/opt/web-app-old` does not live in
        // `/opt/web-app`, and a bare `startsWith` would say it did.
        if (!absolutePath.startsWith(`${entry.path}/`)) continue;
        return nodeAt(entry.id, absolutePath.slice(entry.path.length + 1));
      }
      return -1;
    },

    nodeIndexForEndpoint: (id) => {
      if (endpointIndex === null) {
        endpointIndex = new Map<string, number>();
        held.nodes.forEach((node, position) => {
          if (node.k === 'endpoint') endpointIndex?.set(node.n, position);
        });
      }
      return endpointIndex.get(id) ?? -1;
    },

    routesForRepo: (repoId) => {
      const owners = ownerIndex ?? (ownerIndex = buildOwnerIndex());
      return held.routes.filter((route) => owners[route.n] === repoId);
    },
  };
}
