import fs from 'node:fs';

import type { UniverseRegistryApp, UniverseRegistryEntry } from '@/shared/types.js';

import { universeReposPath } from './universe-state.service.js';

/**
 * The registry, read: which repos are in the estate and what belongs to each one.
 *
 * This is the one reader of `repos.json` in this lane. Two consumers want different slices of it —
 * the heads watcher needs each repo's path, the journal tap needs each repo's units and the star a
 * line falls back to — and a second parse of the same file would be a second set of defaults for
 * the same hand-editable JSON. The file is the crawler's (`scripts/universe/registry.py`), so its
 * schema is the crawler's too; what this service adds is only the tolerance.
 *
 * Tolerant because the file is JSON a person edits: an entry missing `id` or `path` names nothing
 * and is dropped rather than watched or followed; every list is normalized to `[]`; `entry_file`
 * falls back to the empty string, which resolves to the repo's own node. A registry that will not
 * parse yields no repos, which both consumers read as "nothing to do" rather than as an error.
 */

/** The strings in a value that is supposed to be a list of them, and `[]` for anything else. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** One app, or `null` when the entry is not an app: it needs a name and a unit to be routable. */
function appOf(value: unknown): UniverseRegistryApp | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<UniverseRegistryApp>;
  if (typeof raw.name !== 'string' || typeof raw.unit !== 'string') return null;
  return {
    name: raw.name,
    module: typeof raw.module === 'string' ? raw.module : '',
    python: typeof raw.python === 'string' ? raw.python : '',
    cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
    unit: raw.unit,
  };
}

/** One entry in its normalized form, or `null` for anything that names no repo. */
function entryOf(value: unknown): UniverseRegistryEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Partial<UniverseRegistryEntry>;
  if (typeof raw.id !== 'string' || typeof raw.path !== 'string') return null;
  return {
    id: raw.id,
    path: raw.path,
    role: raw.role === 'sun' ? 'sun' : 'galaxy',
    units: stringList(raw.units),
    entry_file: typeof raw.entry_file === 'string' ? raw.entry_file : '',
    apps: Array.isArray(raw.apps)
      ? raw.apps.map(appOf).filter((app): app is UniverseRegistryApp => app !== null)
      : [],
    pg: stringList(raw.pg),
    mcp: stringList(raw.mcp),
  };
}

/** Consumed by `universe-heads.service.ts` (the repos to watch) and `universe-journal.tap.ts` (the units to follow). */
export function readRegistry(): UniverseRegistryEntry[] {
  const file = universeReposPath();
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(entryOf).filter((entry): entry is UniverseRegistryEntry => entry !== null);
  } catch (error) {
    console.error(
      `[Universe] could not read the repo registry at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}
