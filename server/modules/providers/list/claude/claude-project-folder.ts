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
 * consumer: claude-runtime.provider.js (the run loop, and its catch to word the failure)
 */

import { stat } from 'node:fs/promises';

/**
 * A run's working folder is missing or is not a folder. Its message is the whole answer for the
 * person, so the provider's catch sends it to the client as it stands.
 *
 * consumer: claude-runtime.provider.js
 */
export class ProjectFolderMissingError extends Error {
  constructor(folder: string, found: 'nothing' | 'a file') {
    const what = found === 'nothing'
      ? "This project's folder no longer exists on this machine"
      : "This project's path is not a folder on this machine";
    super(`${what}: ${folder}. Restore the folder, or open the chat in another project.`);
    this.name = 'ProjectFolderMissingError';
  }
}

/**
 * Throws `ProjectFolderMissingError` when `cwd` is set and is not an existing directory. A run
 * with no `cwd` has nothing to check. A stat that fails for any other reason (a permission
 * denied on a parent, say) is not this check's diagnosis to make: the spawn that follows fails
 * with its own error, and the host names the folder in it when the folder is the cause.
 *
 * Only for a CLI that starts on THIS machine: a node project's folder lives on the node.
 *
 * consumer: claude-runtime.provider.js (the run loop)
 */
export async function assertProjectFolderExists(cwd: string | undefined): Promise<void> {
  if (!cwd) return;
  let isDirectory: boolean;
  try {
    isDirectory = (await stat(cwd)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOTDIR: a parent in the path is itself a file, so the folder cannot exist either.
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new ProjectFolderMissingError(cwd, 'nothing');
    return;
  }
  if (!isDirectory) throw new ProjectFolderMissingError(cwd, 'a file');
}
