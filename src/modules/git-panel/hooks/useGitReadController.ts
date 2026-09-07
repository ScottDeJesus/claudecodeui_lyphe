import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { GitApiErrorResponse, GitCommitSummary, GitRemoteStatus, GitStatusResponse, Project } from '@/shared/types';

/** How many commits History lists — high enough for the graph to show real branch structure. */
const RECENT_COMMITS_LIMIT = 50;

type GitDiffResponse = GitApiErrorResponse & { diff?: string };
type GitCommitsResponse = GitApiErrorResponse & { commits?: GitCommitSummary[] };
type GitRemoteStatusResponse = GitRemoteStatus & GitApiErrorResponse;

/** One completed read, stamped with the project it describes. */
type LoadedGitState = {
  projectId: string;
  status: GitStatusResponse | null;
  remoteStatus: GitRemoteStatus | null;
  commits: GitCommitSummary[] | null;
  error: string | null;
};

/**
 * Everything the source-control panel can read, and nothing it can write.
 *
 * Two members carry their unknown rather than a stand-in for it. `remoteStatus` is the body
 * as the server sent it, `error` and all — which of its shapes it is gets decided ONCE, by
 * `describeUpstreamPosition`, never here. `commits` is null when that read failed: an empty
 * list is a repository with no history, and History would say so of a read that merely broke.
 *
 * The shape is fixed by the integration plan §6.6. It has no mutating member on purpose:
 * commits and pushes belong to the agent run the panel delegates to, so a write verb here
 * would be the one place a button could grow back.
 */
type GitReadController = {
  status: GitStatusResponse | null;
  remoteStatus: GitRemoteStatus | null;
  commits: GitCommitSummary[] | null;
  loading: boolean;
  error: string | null;
  diffFor: (filePath: string) => Promise<string>;
  refresh: () => Promise<void>;
};

/**
 * Reads one project's git state: working tree, upstream position and recent commits.
 *
 * Used by the git-panel module's GitPanel, which hands the three payloads to its header,
 * its Changes view and its History view. Phase 11's delegation hook takes this same
 * instance so the "did the push land" answer and the lists on screen can never disagree.
 *
 * It reads THREE endpoints per project and no more, and `diffFor` is a call one row makes when
 * it is opened rather than a preload of the list: this repository's own working tree carries
 * 307 changed paths, measured, and a diff apiece is 307 requests for rows nobody has clicked.
 */
export function useGitReadController(project: Project | null): GitReadController {
  // The DB primary key is what every git route takes as its `project` param, and it is a
  // STRING: keying the load on it (rather than on the project object) is what stops a new
  // object identity from the projects context re-fetching on an unrelated render.
  const projectId = project?.projectId ?? null;

  // The last completed read, carrying the project it belongs to. One piece of state rather
  // than four, and stamped, so a read of the PREVIOUS project cannot be shown under this
  // one's name — that mismatch is settled below during render, not by clearing four setters
  // from an effect and hoping the order works out.
  const [loaded, setLoaded] = useState<LoadedGitState | null>(null);
  // The project a read is currently in flight for, or null when nothing is being read.
  // Naming the project rather than holding a boolean means a stale "still loading" from an
  // abandoned project cannot leave this one's refresh control spinning.
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);

  /**
   * Which load is current. A response from an older one is dropped rather than applied,
   * which is what keeps a slow read from overwriting a newer one for the same project.
   * A ref, not state: bumping it must not itself cause a render.
   */
  const loadGenerationRef = useRef(0);

  /**
   * The project the mount read has already been issued for.
   *
   * `load` is stable per project, so the effect below only ever re-runs for the same project
   * because StrictMode remounts the tree in development — and each extra run is three more git
   * subprocesses on the server, one of them a `git status` over a 307-path working tree. The
   * sibling controller in this codebase guards the same way (`useProjectsState.ts:415-424`).
   * `refresh()` calls `load` directly and is deliberately not gated by this.
   */
  const mountReadProjectRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;

    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const isCurrent = () => loadGenerationRef.current === generation;

    setLoadingProjectId(projectId);
    try {
      const [statusResponse, remoteResponse, commitsResponse] = await Promise.all([
        api.git.status(projectId),
        api.git.remoteStatus(projectId),
        api.git.commits(projectId, { limit: RECENT_COMMITS_LIMIT }),
      ]);
      const [statusData, remoteData, commitsData] = await Promise.all([
        statusResponse.json() as Promise<GitStatusResponse>,
        remoteResponse.json() as Promise<GitRemoteStatusResponse>,
        commitsResponse.json() as Promise<GitCommitsResponse>,
      ]);

      if (!isCurrent()) return;

      setLoaded({
        projectId,
        status: statusData,
        remoteStatus: remoteData,
        commits: commitsData.error ? null : commitsData.commits ?? [],
        // A missing repository is a state this panel draws, not a failure worth logging.
        error: statusData.error ?? null,
      });
    } catch (cause) {
      if (!isCurrent()) return;
      console.error('Error reading git state:', cause);
      setLoaded({
        projectId,
        status: null,
        remoteStatus: null,
        commits: null,
        error: cause instanceof Error ? cause.message : 'Could not read this project\'s git state',
      });
    } finally {
      if (isCurrent()) setLoadingProjectId(null);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || mountReadProjectRef.current === projectId) return;
    mountReadProjectRef.current = projectId;
    void load();
    // `load` changes only when `projectId` does, so this is exactly one read per project.
  }, [load, projectId]);

  /**
   * One file's working-tree diff, fetched when a row is opened.
   *
   * It throws rather than returning an empty string on failure: an empty diff and a diff
   * that could not be read are different answers, and only the caller can say which of the
   * two it is looking at.
   */
  const diffFor = useCallback(async (filePath: string): Promise<string> => {
    if (!projectId) {
      throw new Error('No project selected');
    }

    const response = await api.git.diff(projectId, filePath);
    const data = (await response.json()) as GitDiffResponse;
    if (data.error) {
      throw new Error(data.details || data.error);
    }
    return data.diff ?? '';
  }, [projectId]);

  const refresh = useCallback(() => load(), [load]);

  // Answers belong to the project they were read for. Anything else is the previous
  // project's, and reads here as nothing at all.
  const current = loaded && loaded.projectId === projectId ? loaded : null;

  return {
    status: current?.status ?? null,
    remoteStatus: current?.remoteStatus ?? null,
    commits: current?.commits ?? null,
    loading: projectId !== null && loadingProjectId === projectId,
    error: current?.error ?? null,
    diffFor,
    refresh,
  };
}
