import type {
  GitCommitSummary,
  GitDelegationState,
  GitRemoteStatus,
  GitStatusResponse,
} from '@/shared/types';
import { describeUpstreamPosition } from '@/modules/git-panel/utils/gitPanelUtils';
import { hasUncommittedChanges, reasonFor, selectRunCommits } from '@/modules/git-panel/hooks/git-delegation/runEvidence';

/** How many commits the finished card lists. Past this it says the list was cut. */
const RECEIPT_COMMIT_LIMIT = 5;

/** A run that has ended, and everything its own frames said about how it went. */
export type FinishedRun = {
  projectId: string;
  sessionId: string;
  startedAt: number;
  /** Commits already waiting on the upstream when the button was pressed, or null if unread. */
  aheadWhenStarted: number | null;
  /**
   * When this ending was published. A run can end TWICE — once when it stopped answering, and
   * again when its `complete` turns up on a socket that came back — and the second ending needs
   * its own closing read rather than the first one's.
   */
  settledAt: number;
  /** The run reported an error of its own, so git was never asked the question below. */
  agentError: boolean;
  /** The panel stopped following the run — it says so, and claims nothing about the push. */
  lostConnection: boolean;
  /** The last push result the run produced, else its last result — where a failure names itself. */
  lastResultText: string;
};

/** The three payloads the panel's controller read AFTER the run ended, and nothing else. */
export type GitReads = {
  status: GitStatusResponse | null;
  remoteStatus: GitRemoteStatus | null;
  commits: GitCommitSummary[] | null;
};

/**
 * What the panel's git reads say happened — computed from those three payloads and nothing else
 * (plan §3 D5: never from a sentence the agent wrote about itself).
 *
 * Used by `useGitDelegation` once per run, in an effect, so the payloads it reads are the ones
 * React has committed after `controller.refresh()` resolved. It takes the payloads rather than
 * the controller so it cannot reach for a read of its own.
 */
export function deriveFinishedState(run: FinishedRun, reads: GitReads): GitDelegationState {
  const upstream = describeUpstreamPosition(reads.remoteStatus, reads.status);
  // A number only a TRACKED branch has. Every other shape is an unknown, and an unknown may
  // never render as "everything is pushed" (design handoff §5).
  const ahead = upstream.kind === 'tracked' ? upstream.ahead : null;
  // Null when this branch's own commits cannot be told apart from the window's — carried through
  // to the receipt, which then counts nothing rather than counting zero.
  const written = selectRunCommits(reads.commits ?? [], run.startedAt);

  const receipt = {
    phase: 'finished' as const,
    projectId: run.projectId,
    sessionId: run.sessionId,
    startedAt: run.startedAt,
    // The moment the RUN ended, not the moment a panel got round to drawing it. The two differ by
    // however long the operator was on another tab — and "finished 0s ago" for a run that ended
    // twenty minutes ago is exactly the kind of freshness this card must not claim.
    finishedAt: run.settledAt,
    commits: written?.slice(0, RECEIPT_COMMIT_LIMIT) ?? [],
    commitCount: written?.length ?? null,
    ahead,
    aheadWhenStarted: run.aheadWhenStarted,
  };

  // Nobody watched the end of this run, so nothing here may claim how it went — not even when
  // git now reads clean, which a concurrent session could equally have caused.
  if (run.lostConnection) return { ...receipt, outcome: 'connection-lost', reason: null };

  // A run that reported an error of its own is named as one FIRST, as the integration plan
  // specifies. ⚠ The one case where that outranks git: a run that errored, recovered, and pushed
  // anyway would be called a failure while the lists above it read "everything is pushed". Moving
  // this line below the `ahead === 0` test is the whole fix if that combination ever turns up —
  // it has not, and the plan's rule is explicit, so it stays where the plan puts it.
  if (run.agentError) return { ...receipt, outcome: 'agent-error', reason: null };
  if (hasUncommittedChanges(reads.status)) return { ...receipt, outcome: 'not-committed', reason: null };
  if (ahead === 0) return { ...receipt, outcome: 'pushed', reason: null };
  return { ...receipt, outcome: 'not-pushed', reason: reasonFor(run.lastResultText, upstream) };
}
