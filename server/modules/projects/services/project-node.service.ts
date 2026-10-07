import { hintChanged, nodeSessions } from '@/modules/cerberus/index.js';
import { cerberusNodesDb, projectsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/**
 * Records which node's warden a project's Claude sessions are to run on, or `null` for this server.
 * Consumed by `PUT /api/projects/:projectId/node`. The chat dispatch reads the assignment on every
 * turn (`dispatchRun` → `projectsDb.nodeForPath`), so the next CLI the project needs is spawned by
 * that node's warden; a CLI already running keeps running where it was started, and later messages
 * in its chat join it until it ends.
 *
 * Only a node on THIS machine may take a project: a session's working folder is a path on this
 * server's disk, and the warden reads it from its own, so a remote node would run the session in a
 * folder that is not the project. "On this machine" is the relay's judgement (`isColocated`: the
 * node's reported machine id is this machine's). The check is made here, at the assignment, and again
 * at every placement (`node-transport.ts`): a node that later moves machines keeps its projects, its
 * card keeps their rows with the ✕ that moves each back, and a turn in one is refused with that way back.
 *
 * Order of refusals: an unknown project is a 404 whatever the node says, so a mistyped id is never
 * answered with a sentence about nodes. Moving back to this server needs no node at all.
 *
 * After the write, the node cards of the node the project left and the one it joined are hinted
 * (`cerberus_changed`), so a second window or a phone re-reads the lists instead of keeping the old
 * ones until some unrelated hint arrives.
 */
export function setProjectNode(projectId: string, node: string | null): void {
  const project = projectsDb.getProjectById(projectId);
  if (!project) {
    throw new AppError('Project not found', { code: 'PROJECT_NOT_FOUND', statusCode: 404 });
  }

  if (node !== null) {
    // Two sentences, one code: the caller cannot fix a typo and a remote node the same way.
    if (!cerberusNodesDb.get(node)) {
      throw new AppError(`Node "${node}" is not enrolled, so a project cannot run there.`, {
        code: 'PROJECT_NODE_NOT_COLOCATED',
        statusCode: 409,
      });
    }
    if (!nodeSessions.isColocated(node)) {
      throw new AppError(`Node "${node}" is not on this machine, so a project cannot run there.`, {
        code: 'PROJECT_NODE_NOT_COLOCATED',
        statusCode: 409,
      });
    }
  }

  // Read before the write: moving back to this server names no node, and the card it left is the one to redraw.
  const previousNode = projectsDb.nodeForPath(project.project_path);
  projectsDb.setNode(projectId, node);

  const touchedNodes = [previousNode, node].filter((id): id is string => id !== null);
  if (touchedNodes.length > 0) hintChanged({ nodes: touchedNodes });
}
