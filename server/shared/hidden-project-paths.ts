import os from 'node:os';
import path from 'node:path';

/**
 * Where throwaway projects live: probes, fixtures, a scratch session a test needs a folder for.
 * Anything a session creates only to test something goes in a folder under here, so it never
 * reaches a project list. The runner's fixture scripts (`~/.claude/scripts/runner_fixtures/`) mint
 * their plans under `runner-fixtures/` inside it.
 */
export const TEST_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'state', 'test-projects');

/**
 * The folders no project inside is ever shown from. Every chat run in a folder registers that
 * folder as a project, so a probe in `/tmp` or a fixture under `~/.claude/state` became a row in
 * the sidebar, its search and the new-chat picker — and a later run there un-archives it, so
 * archiving never kept them out. The test root, the per-machine state folder that holds it and the
 * older fixtures, and the temp directory (both `/tmp` and whatever `TMPDIR` names) are scratch by
 * definition.
 *
 * Hidden is not gone: the rows stay in the database, and a hidden project's chats still open by
 * link. Read by the project lists, the recent-conversations feed, conversation search, the
 * session-upsert broadcast and the runner's ending notifications.
 */
export const HIDDEN_PROJECT_ROOTS: readonly string[] = [
  ...new Set([TEST_PROJECTS_ROOT, path.join(os.homedir(), '.claude', 'state'), '/tmp', os.tmpdir()]),
];

/** Whether anything at this path — a project folder, a plan file — sits in a hidden root. */
export function isHiddenProjectPath(projectPath: string | null | undefined): boolean {
  if (!projectPath) return false;
  const resolved = path.resolve(projectPath);
  return HIDDEN_PROJECT_ROOTS.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

/**
 * The same rule as a SQL condition on a path column: true when the column is NOT in a hidden root.
 * Returns the clause and its parameters, in order, for a prepared statement.
 *
 * It compares the stored spelling, where `isHiddenProjectPath` resolves `..` first, so for an
 * unnormalized path it can only hide more, never less. Paths are normalized on write, so the two
 * agree on every row today.
 */
export function visibleProjectPathSql(column: string): { clause: string; params: Array<string | number> } {
  const params: Array<string | number> = [];
  const hidden = HIDDEN_PROJECT_ROOTS.map((root) => {
    const prefix = root + path.sep;
    params.push(root, prefix.length, prefix);
    return `${column} = ? OR substr(${column}, 1, ?) = ?`;
  });
  return { clause: `(${column} IS NULL OR NOT (${hidden.join(' OR ')}))`, params };
}
