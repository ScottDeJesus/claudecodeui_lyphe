import { nodeSessions } from '@/modules/cerberus/index.js';
import { projectsDb, sessionsDb } from '@/modules/database/index.js';

/**
 * Whether the chat's CLI runs on a node whose warden lists no live-task ledger for its host. A node chat is taken
 * over like a local one, and what keeps a compaction from ending the process under a running CLI task is the
 * process's own `backgroundTasks`, which a re-adopted process starts from the tasks its host's journal shows
 * running. A warden from before warden 0.12.0 lists none (`liveTasks` is `null` in its listing, never `[]`), so a
 * chat re-adopted from it would read as having no task while a backgrounded subagent or monitor was running, and
 * the compaction would end it. Such a chat keeps the CLI's own compaction until its warden is updated: the answer
 * is read from the node's last list, so it follows the warden the moment a newer one is listed.
 *
 * Consumer: compaction-mode.ts (`takesOver`), auto-trigger.ts (the turn-end test), compaction-runtime.ts (`/compact`).
 */
export function taskLedgerUnlisted(appSessionId: string): boolean {
  const projectPath = sessionsDb.getSessionById(appSessionId)?.project_path;
  const node = projectPath ? projectsDb.nodeForPath(projectPath) : null;
  if (node === null) return false;
  return nodeSessions.lastListed(node).some((host) => host.appSessionId === appSessionId && host.liveTasks === null);
}
