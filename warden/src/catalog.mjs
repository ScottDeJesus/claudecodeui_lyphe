// The catalog: the fixes center has signed for this node, and the only commands the warden will run.
//
// Center pushes the node's whole catalog as `catalog.set { version, entries, oneOffs }` — in `welcome`
// when the warden's version is behind, as a frame of its own whenever an entry changes. Each
// application REPLACES what was held and is answered with `catalog.ack { version }`, the receipt that
// tells center which catalog this node now verifies `run.start` against (`runner.mjs`). The frames are
// `CerberusCatalogSet` and `catalog.ack` in `server/shared/cerberus-types.ts`.
//
//   NEVER BACKWARDS  versions only go up at center, and a signature proves who sent a frame, not when: an older
//                    signed `catalog.set` delivered late would put a retired command back in the catalog. So a
//                    `catalog.set` below the held version is logged and ignored, with no ack. The catalog in a
//                    `welcome` is the exception — center chose it for this very connection, so a center whose
//                    store went back to a lower version still converges.
//   ENTRIES   `{ id, cmd, timeout }`, kept until the next set replaces them.
//   ONE-OFFS  `{ id, cmd, timeout, expiresAt }`: the proposal of a diagnosis, good until `expiresAt` and no
//             longer. Expiry is read when a run asks (`find`), never by a timer: an expired one-off is
//             dropped then, and its id is remembered with the moment it lapsed so the refusal can say
//             "expired at 18:54" and not "no such entry".
//   NOTHING PERSISTS. A restarted warden says `catalogVersion: null` in `hello` and center answers with
//   the catalog in `welcome`, so a copy on disk could only ever be a second, staler truth.
import { log } from './log.mjs';

function isWholeSeconds(value) {
  return Number.isInteger(value) && value >= 1;
}

/** Whether `item` has what a run needs: an id, a command and a whole-second timeout. */
function usable(item) {
  return typeof item === 'object' && item !== null && typeof item.id === 'string' && item.id !== ''
    && typeof item.cmd === 'string' && item.cmd !== '' && isWholeSeconds(item.timeout);
}

/**
 * @param {{ link: {
 *   on(type: string, handler: (body: object) => void): unknown,
 *   send(type: string, body: object, options?: { reliable?: boolean }): unknown,
 * }} options `link` is the warden's link, or anything with `on` and `send`.
 */
export function createCatalog({ link }) {
  let version = null; // the version last acked: what `hello` reports and what `run.start` must name
  let byId = new Map(); // id → { id, cmd, timeout, expiresAt? } — expiresAt only on a one-off
  const lapsed = new Map(); // id → the expiresAt of a one-off found past it

  /** Drops `held` when it is a one-off past its moment, remembering when; answers whether it did. */
  function dropIfLapsed(held) {
    if (held.expiresAt === undefined || held.expiresAt > Date.now()) return false;
    byId.delete(held.id);
    lapsed.set(held.id, held.expiresAt);
    return true;
  }

  /** Takes `set` as the catalog and acks it; `fromWelcome` is the one case a lower version than the held one is taken. */
  function apply(set, { fromWelcome }) {
    const oneOffs = set?.oneOffs ?? [];
    if (!Number.isSafeInteger(set?.version) || !Array.isArray(set.entries) || !Array.isArray(oneOffs)) {
      log('ignoring a catalog.set without a version, a list of entries and a list of one-offs');
      return;
    }
    if (!fromWelcome && version !== null && set.version < version) {
      log(`ignoring a catalog.set of version ${set.version}: this warden holds version ${version}`);
      return;
    }
    const next = new Map();
    const take = (item, isOneOff) => {
      // A one-off with no moment to end at would live until the next set: not usable.
      if (!usable(item) || (isOneOff && !Number.isFinite(item.expiresAt))) {
        log(`ignoring a catalog item that is not usable: ${typeof item?.id === 'string' ? item.id : 'it has no id'}`);
        return;
      }
      const { id, cmd, timeout } = item;
      next.set(id, isOneOff ? { id, cmd, timeout, expiresAt: item.expiresAt } : { id, cmd, timeout });
    };
    for (const oneOff of oneOffs) take(oneOff, true);
    for (const entry of set.entries) take(entry, false); // last: where an id is both, the entry is the one a person wrote
    byId = next;
    lapsed.clear();
    for (const held of [...byId.values()]) dropIfLapsed(held);
    version = set.version;
    link.send('catalog.ack', { version });
    log(`now holding catalog version ${version}: ${set.entries.length} entr${set.entries.length === 1 ? 'y' : 'ies'}, ${oneOffs.length} one-off(s)`);
  }

  link.on('catalog.set', (set) => apply(set, { fromWelcome: false }));
  link.on('welcome', (welcome) => {
    if (welcome?.catalog) apply(welcome.catalog, { fromWelcome: true });
  });

  return {
    /** The version last acked, or null before any. */
    get version() {
      return version;
    },
    /**
     * What `id` is in the held catalog: `{ id, cmd, timeout }`, `{ expiredAt }` for a one-off past its
     * moment (it is dropped now), or null when the catalog has no such id.
     */
    find(id) {
      const held = byId.get(id);
      if (held && !dropIfLapsed(held)) return held;
      return lapsed.has(id) ? { expiredAt: lapsed.get(id) } : null;
    },
  };
}
