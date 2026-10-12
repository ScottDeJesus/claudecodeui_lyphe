/**
 * The pre-flight at the one door a Claude CLI is started through: a run whose project folder is
 * gone is refused in plain words BEFORE any host or process is started.
 *
 * Why it must come first. `tmux new-session -c <missing dir>` silently falls back to the home
 * directory, so the host starts; the host's `spawn(command, { cwd })` then fails with an ENOENT
 * whose message blames the BINARY (`spawn …/claude ENOENT`) although the binary is fine. This check
 * answers in plain words, before any process; where it does not run (a node's project, a folder
 * removed after the stat) the host itself puts the folder in that message (`explainSpawnError`,
 * host.js).
 *
 * consumer: claude-runtime.provider.js (the run loop, and its catch to word the failure); the projects
 * module's list, which asks the same folder question (`diagnoseProjectFolder`) to mark a gone project.
 */

import { stat } from 'node:fs/promises';

/** What is wrong with a folder: nothing is there at the path, or what is there is not a folder. */
type ProjectFolderProblem = 'nothing' | 'a file';

/**
 * The ONE folder test: what is wrong with `folder`, or `null` when it is an existing directory — or
 * when the stat fails for any reason that is not a diagnosis (a permission denied on a parent, say:
 * the spawn that follows fails with its own error, and the host names the folder in it when the
 * folder is the cause).
 *
 * consumer: this file's `assertProjectFolderExists` (the run's pre-flight) and the projects module's
 * project list (through the providers barrel), which marks a project whose folder this finds gone.
 */
export async function diagnoseProjectFolder(folder: string): Promise<ProjectFolderProblem | null> {
  try {
    return (await stat(folder)).isDirectory() ? null : 'a file';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOTDIR: a parent in the path is itself a file, so the folder cannot exist either.
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'nothing' : null;
  }
}

/**
 * A run's working folder is missing or is not a folder. Its message is the whole answer for the
 * person, so the provider's catch sends it to the client as it stands. It offers only what the app
 * can do: the folder can be put back, or a new chat started in another project.
 *
 * consumer: claude-runtime.provider.js
 */
export class ProjectFolderMissingError extends Error {
  constructor(folder: string, found: ProjectFolderProblem) {
    const what = found === 'nothing'
      ? "This project's folder no longer exists on this machine"
      : "This project's path is not a folder on this machine";
    super(`${what}: ${folder}. Restore the folder to continue this chat, or start a new chat in another project.`);
    this.name = 'ProjectFolderMissingError';
  }
}

/**
 * Throws `ProjectFolderMissingError` when `cwd` is set and `diagnoseProjectFolder` finds it gone. A
 * run with no `cwd` has nothing to check.
 *
 * Only for a CLI that starts on THIS machine: a node project's folder lives on the node.
 *
 * consumer: claude-runtime.provider.js (the run loop)
 */
export async function assertProjectFolderExists(cwd: string | undefined): Promise<void> {
  if (!cwd) return;
  const problem = await diagnoseProjectFolder(cwd);
  if (problem) throw new ProjectFolderMissingError(cwd, problem);
}
