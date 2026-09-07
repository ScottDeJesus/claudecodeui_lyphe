import { FILE_STATUS_GROUPS } from '@/shared/constants';
import type {
  GitCommitSummary,
  GitDelegationReason,
  GitDelegationStage,
  GitStatusResponse,
  ServerEvent,
  UpstreamPosition,
} from '@/shared/types';

/**
 * What the delegated run's own websocket frames prove, and nothing else.
 *
 * Every function here reads a COMMAND the agent asked to run, or git's own answer to one. None
 * of them reads the agent's prose: a run that says "✓ Pushed" has said nothing this panel is
 * allowed to repeat, and the outcome is decided by `useGitDelegation` from a fresh git read.
 *
 * Used only by `useGitDelegation` in this package — it lives beside the hook rather than inside
 * it so both stay readable whole.
 */

/** Ranked, so a step only ever moves forward and a compound command lands on the furthest thing it does. */
export const STAGE_ORDER: Record<GitDelegationStage, number> = {
  starting: 0,
  read: 1,
  group: 2,
  write: 3,
  push: 4,
};

/** The git subcommand each of the card's four step lines is named after. */
const SUBCOMMAND_STAGES: Record<string, GitDelegationStage> = {
  status: 'read',
  diff: 'read',
  add: 'group',
  commit: 'write',
  push: 'push',
};

/**
 * git's global options that take a SEPARATE value, so the token after one of them is not the
 * subcommand. The operator's own command drives every repository as `git -C <repo> …`, which is
 * exactly this case — a reader that stopped at the first token after `git` would tick no step
 * at all on a real run.
 */
const GIT_OPTIONS_TAKING_A_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

/**
 * What separates one command from the next inside a single Bash call — newlines included, so a
 * heredoc commit body is read as its own segments rather than as a tail of the `git commit` that
 * opened it.
 */
const SHELL_SEPARATORS = /&&|\|\||;|\||\n/;

/**
 * Why a commit that exists was not pushed, matched against the run's last tool result — git's
 * own words, most specific cause first. `CONFLICT` is case-sensitive because that is how git
 * shouts it, while lowercase "conflict" is a word that turns up in prose.
 */
const REASON_PATTERNS: [RegExp, GitDelegationReason][] = [
  [/rejected|non-fast-forward/i, 'rejected'],
  [/protected/i, 'protected'],
  [/no upstream|set-upstream/i, 'no-upstream'],
  [/CONFLICT/, 'conflict'],
  [/Authentication failed|could not read Username|Permission denied \(publickey\)/i, 'credentials'],
];

/**
 * The stage a Bash command proves, or null when it is not a git command this card follows.
 *
 * Read off the COMMAND, never off a result: `git status --porcelain` prints the word "commit"
 * in its own output often enough, and a step that ticked on someone else's text would report a
 * push that never happened. The subcommand is found by POSITION — `git`, then its global
 * options, then the first bare token — so `git commit -m "push it"` reads as a commit.
 *
 * What it does NOT rule out: a multi-line commit BODY whose own line begins with a git command
 * ticks that step. Cosmetic only — every step line is a claim about the run's progress, and the
 * outcome underneath comes from git, never from here.
 */
export function stageOfCommand(command: string): GitDelegationStage | null {
  let furthest: GitDelegationStage | null = null;

  for (const segment of command.split(SHELL_SEPARATORS)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    const gitIndex = tokens.findIndex((token) => token === 'git' || token.endsWith('/git'));
    if (gitIndex === -1) continue;

    let index = gitIndex + 1;
    while (index < tokens.length && tokens[index].startsWith('-')) {
      index += GIT_OPTIONS_TAKING_A_VALUE.has(tokens[index]) ? 2 : 1;
    }

    const stage = SUBCOMMAND_STAGES[tokens[index] ?? ''];
    if (stage && (furthest === null || STAGE_ORDER[stage] > STAGE_ORDER[furthest])) {
      furthest = stage;
    }
  }

  return furthest;
}

/** The Bash tool's `command`, or an empty string for any input shape that carries none. */
export function readCommand(toolInput: unknown): string {
  if (typeof toolInput !== 'object' || toolInput === null) return '';
  const command = (toolInput as { command?: unknown }).command;
  return typeof command === 'string' ? command : '';
}

/** A tool result's text, from either shape the gateway sends it in. */
export function readResultText(event: ServerEvent): string {
  if (typeof event.content === 'string') return event.content;
  const result = event.toolResult;
  if (typeof result === 'object' && result !== null) {
    const content = (result as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }
  return '';
}

/** True when the working tree still holds any of the four kinds of change the panel lists. */
export function hasUncommittedChanges(status: GitStatusResponse | null): boolean {
  if (!status) return false;
  // The same four groups the changed-file list draws. `staged` is a subset FLAG over those
  // paths, never a fifth group, so counting it would count half this tree twice.
  return FILE_STATUS_GROUPS.some(({ key }) => (status[key]?.length ?? 0) > 0);
}

/**
 * Whether this commit was written during the run.
 *
 * git records a commit date to the SECOND and the run started at a millisecond, so the
 * comparison is made at second resolution — otherwise a commit made in the same second as the
 * press rounds down below the start and drops out of its own receipt. An unparseable date is
 * never claimed for the run.
 */
function wasWrittenDuring(commit: GitCommitSummary, startedAt: number): boolean {
  const writtenAt = Date.parse(commit.date);
  return Number.isFinite(writtenAt) && writtenAt >= Math.floor(startedAt / 1000) * 1000;
}

/**
 * The commits THIS BRANCH gained while the run was going, newest first — or null when that cannot
 * be said at all.
 *
 * Anchored at HEAD and walking down, not filtered across the whole window: `/commits` is
 * `git log --branches --remotes --tags` (every ref), and a bare "newer than the press" filter over
 * that list hands the receipt commits from other branches — on a host where several sessions share
 * one repository, that is the normal case, not the exotic one. The walk stops at the first commit
 * older than the press, which is also what keeps a rebased commit carrying its original author
 * date from being claimed.
 *
 * ⚠ What the anchor rules out is a foreign commit sorted ABOVE HEAD. One sorted BELOW it, inside
 * the run's own window, is still claimable — the list is only provably this branch's when it is
 * read as `@{u}..HEAD`, a server read this panel has not got. Its sibling `selectUnpushedCommits`
 * carries the same caveat for the same reason.
 *
 * Null, never an empty list, when HEAD is not in the window at all: "the run wrote nothing here"
 * and "which commits are this branch's is unknown" are different answers, and only one of them
 * belongs on a receipt.
 */
export function selectRunCommits(commits: GitCommitSummary[], startedAt: number): GitCommitSummary[] | null {
  const headIndex = commits.findIndex((commit) =>
    commit.refs?.some((ref) => ref === 'HEAD' || ref.startsWith('HEAD -> ')));
  if (headIndex === -1) return null;

  const written: GitCommitSummary[] = [];
  for (let index = headIndex; index < commits.length; index += 1) {
    if (!wasWrittenDuring(commits[index], startedAt)) break;
    written.push(commits[index]);
  }
  return written;
}

/** Why the push did not land — from the run's own last words, and from git's when they say nothing. */
export function reasonFor(lastResultText: string, upstream: UpstreamPosition): GitDelegationReason {
  for (const [pattern, reason] of REASON_PATTERNS) {
    if (pattern.test(lastResultText)) return reason;
  }
  // Nothing in the run named a cause, but git's own answer is still evidence: a branch with no
  // upstream cannot have pushed to one, and saying that beats "we don't know" when we do.
  if (upstream.kind === 'no-upstream') return 'no-upstream';
  return 'unknown';
}
