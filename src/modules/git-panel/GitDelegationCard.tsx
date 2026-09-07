import { useEffect, useState } from 'react';

import { Badge, Banner, Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui';
import StartRefusalBanner from '@/modules/git-panel/StartRefusalBanner';
import { FILE_STATUS_GROUPS, GIT_DELEGATION_COMMAND } from '@/shared/constants';
import type { GitDelegationStage, GitDelegationState, GitStatusResponse, UpstreamPosition } from '@/shared/types';

type GitDelegationCardProps = {
  state: GitDelegationState;
  /** The working tree as the panel last read it — the idle caption counts what is in it. */
  status: GitStatusResponse | null;
  /** Where this branch stands against its upstream, decided once by GitPanel for every consumer. */
  upstream: UpstreamPosition;
  /** A press is on its way — two server reads happen before a run exists to narrate. */
  starting?: boolean;
  /** Something to say about the run on screen, when the press did not start it. */
  notice?: string | null;
  onStart: () => void;
  onDismiss: () => void;
  onOpenConversation: (sessionId: string) => void;
};

/** The four things the run does, in the order it does them. */
const STEP_LABELS = [
  'Reading the changed files',
  'Grouping them into commits',
  'Writing the commit messages',
  'Pushing to origin/main',
];

/** Below this the receipt counts in seconds; above it, in whole minutes. */
const A_MINUTE_IN_SECONDS = 60;

/** Changed ENTRIES, counted the way the list above counts them: a wholly untracked folder is one. */
function countChangedEntries(status: GitStatusResponse | null): number {
  if (!status) return 0;
  // `staged` is a subset flag over these four groups, never a fifth group — including it would
  // count every staged path twice.
  return FILE_STATUS_GROUPS.reduce((total, { key }) => total + (status[key]?.length ?? 0), 0);
}

/**
 * What this repository brings to the run, said in one line under the button.
 *
 * Keyed on the SAME `UpstreamPosition` the header badge and the unpushed list read, never on a
 * bare `ahead`. It does not gate the button: the command commits and pushes EVERY repository in
 * the checkpoint, so "nothing waiting here" is a fact about this panel, never a reason to say
 * there is nothing to do.
 */
function describeIdle(changedCount: number, upstream: UpstreamPosition): string {
  if (changedCount > 0) {
    return `${changedCount} ${changedCount === 1 ? 'file' : 'files'} here · commits are grouped by intent, then pushed to main`;
  }

  switch (upstream.kind) {
    case 'tracked':
      return upstream.ahead === 0
        ? 'Nothing waiting here — the run still covers every other repository'
        : `Nothing changed here · ${upstream.ahead} ${upstream.ahead === 1 ? 'commit is' : 'commits are'} already waiting to be pushed`;
    case 'no-commits':
      return 'Nothing committed here yet — the run still covers every other repository';
    case 'no-upstream':
      return "Nothing changed here, and this branch isn't tracking a remote";
    case 'unread':
      return "Nothing changed here; what is waiting to be pushed couldn't be read";
  }
}

/**
 * The mark each step line carries: what is done, what is happening, and what has not started.
 *
 * A step is only ✓ once a command PROVED it, so `read` leaves nothing current — the run has read
 * and has not yet been seen doing anything else. Guessing at the next step is how a card ends up
 * claiming a commit that never happened.
 */
function stepMarks(stage: GitDelegationStage): string[] {
  const [done, current] = {
    starting: [0, 1],
    read: [1, 0],
    group: [1, 2],
    write: [2, 3],
    push: [3, 4],
  }[stage];

  return STEP_LABELS.map((_, index) => {
    const step = index + 1;
    if (step <= done) return '✓ ';
    return step === current ? '● ' : '· ';
  });
}

/** How long ago the run ended, in the largest unit that still says something. */
function formatAge(seconds: number): string {
  return seconds < A_MINUTE_IN_SECONDS
    ? `${seconds}s ago`
    : `${Math.floor(seconds / A_MINUTE_IN_SECONDS)}m ago`;
}

/** The one sentence a finished run that did not push gets, in its own words for each cause. */
function describeFailure(state: Extract<GitDelegationState, { phase: 'finished' }>): string {
  if (state.outcome === 'connection-lost') {
    // Observed: it went quiet and then did not answer when asked. Whether it is still going, and
    // whether it pushed, are both unknown from here — so neither is claimed.
    return 'We stopped hearing from this run — read the conversation to see how it ended.';
  }
  if (state.outcome === 'agent-error') return 'Claude could not finish — read the conversation.';
  if (state.outcome === 'not-committed') {
    return 'Some changes are still not committed — read the conversation to see what stopped it.';
  }

  switch (state.reason) {
    case 'rejected':
      return 'The push was rejected — origin/main has moved. Pull and merge, then press again.';
    case 'protected':
      return 'main is protected on origin — the push was refused.';
    case 'no-upstream':
      return 'This branch has no upstream to push to.';
    case 'conflict':
      return 'A merge conflict stopped the push — open the conversation to resolve it.';
    case 'credentials':
      return 'Git could not sign in to origin — fix the credentials on this machine, then press again.';
    default:
      // Nothing named a cause. With a count, the count is the fact worth saying; without one the
      // read itself failed, and inventing a number for it would be worse than saying so.
      return state.ahead === null
        ? "Git couldn't be read afterwards, so whether anything was pushed is unknown — read the conversation."
        : `${state.ahead} ${state.ahead === 1 ? 'commit is' : 'commits are'} still waiting to be pushed — read the conversation.`;
  }
}

/**
 * What a successful run left behind here, or what it pushed that was already waiting.
 *
 * Three answers, and the third is a silence on purpose: a null count means this branch's commits
 * could not be told from the window's, and "nothing new here" would be a claim rather than a
 * reading. A zero is a real zero and says so.
 */
function describeReceipt(state: Extract<GitDelegationState, { phase: 'finished' }>, ageSeconds: number): string {
  const written = state.commitCount === null
    ? ''
    : state.commitCount > 0
      ? `${state.commitCount} ${state.commitCount === 1 ? 'commit' : 'commits'} · `
      // A clean tree that was simply behind: the run wrote nothing here and pushed what was
      // waiting. Saying "finished 0s ago" alone would be a receipt for nothing at all.
      : state.aheadWhenStarted
        ? `${state.aheadWhenStarted} ${state.aheadWhenStarted === 1 ? 'commit' : 'commits'} that were waiting · `
        : 'Nothing new here · ';
  return `${written}finished ${formatAge(ageSeconds)} · conversation ended`;
}

/**
 * Rendered by GitPanel in its delegation slot: the one place in the app where a git WRITE can be
 * started, and it starts a conversation rather than performing one.
 *
 * Everything after the press is reported from the panel's own git reads (`useGitDelegation`), so
 * this component never parses what the agent said about itself — it draws a state that was
 * already decided from git.
 */
export default function GitDelegationCard({
  state,
  status,
  upstream,
  starting = false,
  notice = null,
  onStart,
  onDismiss,
  onOpenConversation,
}: GitDelegationCardProps) {
  // Ticks the "finished …" line. Without it the elapsed time freezes at the second the run ended,
  // which reads as a receipt for something that just happened however long ago it was. It starts
  // at mount, so the first second of a receipt reads 0s (clamped below) — never a negative age.
  const [now, setNow] = useState(() => Date.now());

  const showingReceipt = state.phase === 'finished' && state.outcome === 'pushed';
  const ageSeconds = state.phase === 'finished'
    ? Math.max(0, Math.round((now - state.finishedAt) / 1000))
    : 0;
  // Past a minute the line reads in whole minutes, so a per-second render buys nothing; an old
  // receipt left on screen is not worth a wake-up every second for the rest of the day.
  const tickMs = ageSeconds < A_MINUTE_IN_SECONDS ? 1000 : 30_000;

  useEffect(() => {
    if (!showingReceipt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [showingReceipt, tickMs]);

  const readConversation = state.phase !== 'idle' && (
    <Button variant="outline" size="sm" onClick={() => onOpenConversation(state.sessionId)}>
      Read the conversation
    </Button>
  );

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle className="font-serif text-[20px] font-normal leading-tight">
          Claude writes and <span className="italic text-accent-ink">pushes</span> the commits
        </CardTitle>
        <p className="max-w-[520px] text-[13px] leading-relaxed text-muted-foreground">
          One button starts a Sonnet conversation and runs{' '}
          {/* The command as the app will actually send it — the one place its configured value
              is legible, so what this card promises and what the run receives are one string. */}
          <span data-delegation-command className="font-mono text-xs">{GIT_DELEGATION_COMMAND}</span>
          {' '}— the checkpoint that commits and pushes every repository, not only this one. It ends
          when the last push finishes. You are told when it is done; there is nothing to fill in.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {/* Said about the run below it — a press that found one rather than starting one has no
            other way to explain itself, because by then the card is narrating that run. */}
        {notice && (
          <Banner tone="info">
            <p className="text-sm">{notice}</p>
          </Banner>
        )}

        {state.phase === 'idle' && (
          <>
            {state.startError && (
              <StartRefusalBanner message={state.startError} sessionId={state.blockedBySessionId} onOpenConversation={onOpenConversation} />
            )}
            <div className="flex flex-wrap items-center gap-3">
              {/* Disabled only while this press is on its way. It is never disabled for having
                  nothing to do here: the run covers every other repository too. */}
              <Button onClick={onStart} disabled={starting}>Push my changes</Button>
              <span className="text-[12.5px] text-ink-faint">
                {starting
                  ? 'Checking whether a run is already going…'
                  : describeIdle(countChangedEntries(status), upstream)}
              </span>
            </div>
          </>
        )}

        {state.phase === 'running' && (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge tone="info">● Claude is running {GIT_DELEGATION_COMMAND}</Badge>
              <span className="text-[12.5px] text-muted-foreground">
                Sonnet · conversation ends on its own when the last push finishes
              </span>
            </div>
            <div className="flex flex-col gap-[7px] font-mono text-[12.5px]">
              {stepMarks(state.stage).map((mark, index) => (
                <div
                  key={STEP_LABELS[index]}
                  className={mark === '✓ ' ? 'text-muted-foreground' : mark === '● ' ? 'text-foreground' : 'text-ink-faint'}
                >
                  {mark}{STEP_LABELS[index]}
                </div>
              ))}
            </div>
            {/* A run in flight is not a dead end: the conversation is where it is actually
                happening, and this is the way into it without waiting for the card to settle. */}
            <div className="flex flex-wrap items-center gap-3">{readConversation}</div>
          </>
        )}

        {state.phase === 'finished' && (
          <>
            {state.outcome === 'pushed' ? (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge tone="positive">✓ Pushed to main</Badge>
                  <span className="text-[12.5px] text-muted-foreground">{describeReceipt(state, ageSeconds)}</span>
                </div>
                {state.commits.length > 0 && (
                  <div className="flex flex-col gap-1.5 font-mono text-[12.5px] text-muted-foreground">
                    {state.commits.map((commit) => (
                      <div key={commit.hash} className="truncate">
                        <span className="text-accent-ink">{commit.hash.slice(0, 7)}</span> {commit.message}
                      </div>
                    ))}
                    {/* The receipt lists five at most, and a list silently cut reads as the whole truth. */}
                    {state.commitCount !== null && state.commitCount > state.commits.length && (
                      <p className="text-ink-faint">Showing the most recent {state.commits.length}.</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Amber, never red: a run that did not finish its push is an error, and errors are
                 warn (doctrine §5). The banner's own mark carries it without the colour. */
              <Banner tone="warn">
                <p className="text-sm">{describeFailure(state)}</p>
              </Banner>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {readConversation}
              <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
