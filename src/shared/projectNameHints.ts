// The one rule for telling same-named projects apart. Two folders can both be called
// `claudecodeui_lyphe` (a worktree, a copy, a checkout elsewhere), and every list that names a
// project by its name alone then shows two identical labels. The hint is computed ONCE over the
// whole visible project list and handed down, so a project reads the same in the new-chat picker,
// the chat list and the session picker — a hint worked out per list would differ with the list.
import type { Project } from '@/shared/types';

type NamedProject = Pick<Project, 'projectId' | 'displayName' | 'fullPath'>;

/** Every folder name of a path, outermost first: `/a/b/proj` gives `['a', 'b', 'proj']`. */
function folderNames(fullPath: string): string[] {
  return fullPath.split(/[\\/]+/).filter(Boolean);
}

/** The last `depth` parent names joined; a project sitting at the filesystem root has none, and reads `/`. */
function trailingParents(parents: string[], depth: number): string {
  return parents.length === 0 ? '/' : parents.slice(-depth).join('/');
}

/**
 * Used by project-workspace (the new-chat project picker's choices), sidebar (the chat list's rows
 * and the session picker's rows) and settings (the default-project picker). For every project whose
 * display name another project in `projects` shares, the hint that sets it apart: the fewest trailing parent-folder names that differ from every
 * other project of that name — `/home/lyphe/.claude/proj` against `/home/lyphe/bakeoff/arms/opus/proj`
 * reads `.claude` and `opus`, and where the last parents collide one more is taken (`a/x`, `b/x`).
 *
 * Two projects of one name in the SAME parent folder (`/home/me/foo` renamed `repo`, beside
 * `/home/me/repo`) share every parent, so parent names cannot part them: those take their own folder
 * names instead (`foo`, `repo`), lengthened with the parents above only when another hint already
 * reads the same.
 *
 * Returns a map from `projectId` to hint holding ONLY the projects that need one; a project with a
 * unique name has no entry, so a reader asks `hints.get(id) ?? null`. The hint is secondary text to
 * draw beside the name — never fold it into `displayName`, which a rename box and the server read.
 * Pass the whole visible list, not a filtered one, or two same-named projects can lose the other.
 */
export function projectNameHints(projects: readonly NamedProject[]): Map<string, string> {
  const sharingAName = new Map<string, NamedProject[]>();
  for (const project of projects) {
    const sameName = sharingAName.get(project.displayName);
    if (sameName) sameName.push(project);
    else sharingAName.set(project.displayName, [project]);
  }

  const hints = new Map<string, string>();
  for (const sameName of sharingAName.values()) {
    if (sameName.length < 2) continue;

    const pathsOf = sameName.map((project) => folderNames(project.fullPath));
    const parentsOf = pathsOf.map((names) => names.slice(0, -1));
    const deepest = Math.max(...parentsOf.map((parents) => parents.length));

    const groupHints = sameName.map((_, index) => {
      // Past the last parent a path has no more names to give, so the search ends at the deepest
      // path in the group: a hint that is still shared by then is a whole parent path, and only a
      // project in the very same folder has one of those.
      let depth = 1;
      while (
        depth < deepest
        && parentsOf.some((other, otherIndex) => otherIndex !== index
          && trailingParents(other, depth) === trailingParents(parentsOf[index], depth))
      ) {
        depth += 1;
      }
      return trailingParents(parentsOf[index], depth);
    });

    // A hint two projects still share means one parent folder holds both. Their own folder names
    // differ (a folder's name is unique within its parent), so that is where their hint comes from:
    // the fewest trailing names of the whole path that no other hint of the group already reads.
    const sharedHints = new Set(groupHints.filter((hint) => groupHints.indexOf(hint) !== groupHints.lastIndexOf(hint)));
    groupHints.forEach((hint, index) => {
      if (!sharedHints.has(hint)) return;
      const taken = new Set(groupHints.filter((_, otherIndex) => otherIndex !== index));
      const names = pathsOf[index];
      let depth = 1;
      while (depth < names.length && taken.has(names.slice(-depth).join('/'))) depth += 1;
      groupHints[index] = names.slice(-depth).join('/');
    });

    sameName.forEach((project, index) => hints.set(project.projectId, groupHints[index]));
  }
  return hints;
}
