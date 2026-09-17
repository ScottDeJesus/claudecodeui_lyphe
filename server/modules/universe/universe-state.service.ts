import path from 'node:path';

import { expandHome } from '@/shared/utils.js';

/**
 * Where the universe keeps its state — the registry of repos and the map the crawler writes — and
 * the one place this lane spells any of it.
 *
 * The layout is the crawler's (`scripts/universe/registry.py:92-102`, `build.py:112`), because the
 * code that WRITES a file owns its location; a second opinion here would be a second layout, and
 * the lane would go on reading yesterday's path after the crawler moved. The override is the
 * crawler's own too, read per call rather than cached, so pointing a probe at a hermetic tree moves
 * every reader in the lane at once.
 *
 * The override is taken VERBATIM, exactly as the crawler takes it, and only the default is
 * expanded: a `~` here would mean one directory to the server and a literal `~/…` under the
 * crawler's cwd while both went on running. One env var cannot name two places — so write an
 * override as an absolute path, which is the same rule the crawler has.
 */
const DEFAULT_STATE_DIR = '~/.claude/state/universe';

/** The universe's state root: the registry, and the map directory below it. */
export function universeStateDir(): string {
  return process.env.UNIVERSE_STATE_DIR || expandHome(DEFAULT_STATE_DIR);
}

/** The registry: which repos are in the estate, and what belongs to each one. */
export function universeReposPath(): string {
  return path.join(universeStateDir(), 'repos.json');
}

/**
 * The map the fork reads. The per-repo files beside it are the crawler's own working form — a
 * reader that wants one answer about the whole estate wants this file, and nothing else.
 */
export function universeMergedMapPath(): string {
  return path.join(universeStateDir(), 'map', 'merged.json');
}
