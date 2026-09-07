import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { GitDelegationState } from '@/shared/types';
import { describeUpstreamPosition } from '@/modules/git-panel/utils/gitPanelUtils';
import type { useGitReadController } from '@/modules/git-panel/hooks/useGitReadController';
import { deriveFinishedState } from '@/modules/git-panel/hooks/git-delegation/deriveOutcome';
import { createDelegationSession, sendDelegationPrompt } from '@/modules/git-panel/hooks/git-delegation/startRun';
import { checkForLiveDelegationRun, markRunSettled } from '@/modules/git-panel/hooks/git-delegation/findLiveRun';
import {
  activeRun,
  adoptRun,
  beginRun,
  dismissRun,
  getRunSnapshot,
  settleRun,
  subscribeToRunStore,
} from '@/modules/git-panel/hooks/git-delegation/runStore';

/** The panel's own read of git, handed in by GitPanel. This hook never opens a second one. */
type GitReadController = ReturnType<typeof useGitReadController>;

/**
 * Why a press did not become a run, and the conversation to read about it when there is one.
 * Local to the panel that pressed — never the run's own state.
 */
type StartRefusal = { message: string; sessionId: string | null } | null;

/** The other project by the name the server gave it, or an honest stand-in when it gave none. */
const describeProject = (name: string | null): string => name ?? 'another project';

/**
 * Runs the operator's own git command as a Claude conversation, and reports what it did from the
 * panel's git reads.
 *
 * Used by GitPanel, which owns the one `useGitReadController` and hands it here, so the lists above
 * the card and the sentence inside it are the same answer (plan §6.6, Eupalinos F5). The only fetch
 * this hook makes is the one that creates the conversation; every fact it reports comes back through
 * `controller.refresh()`, and it calls no git route of its own.
 *
 * The client's whole part in the write is the session id and the prompt — the server resolves the
 * provider, the working directory and the project path from the session row it created
 * (`server/modules/websocket/services/chat-websocket.service.ts`, `resolveSendTarget` →
 * `dispatchRun`).
 *
 * ONE checkpoint at a time for the whole HOST, not one per project: the command drives four absolute
 * `git -C <repo>` paths, so the conversation's project decides nothing about what is committed and
 * pushed. A run going in any project refuses a press in every panel — adopted and narrated where it
 * belongs, named and refused everywhere else.
 *
 * The run does NOT live here: the panel is unmounted whenever the workspace shows another tab, so
 * the run, its subscription and its watchdog live in `runStore` at module scope. This hook binds a
 * mounted panel to whatever is going on there — which is why coming back to the tab shows the run in
 * flight rather than an armed button.
 */
export function useGitDelegation(
  project: { id: string; path: string } | null,
  controller: GitReadController,
): {
  state: GitDelegationState;
  starting: boolean;
  notice: string | null;
  start: () => Promise<void>;
  dismiss: () => Promise<void>;
} {
  const { sendMessage, subscribe, isConnected } = useWebSocket();
  const { state, pending } = useSyncExternalStore(subscribeToRunStore, getRunSnapshot);
  // Which sessions the SERVER says are processing, polled every 5s by a provider above the
  // workspace. It is the same set the sidebar's activity chip draws on, and it is the only part of
  // this guard that survives a reload, a second tab, or an HMR update of the store.
  const busySessionIds = useBusySessionIdSet();

  // Why THIS panel's last press did not start a run. Deliberately not in the store: a refusal
  // belongs to the person who pressed, and writing it into the shared state would replace the
  // narration of the very run it just protected.
  const [refusal, setRefusal] = useState<StartRefusal>(null);
  // A press that is on its way. It exists so the button can say so, and so the two reads between
  // the press and the recorded run cannot be raced by a second click.
  const [starting, setStarting] = useState(false);
  // The same fact again as a ref, because the state above is not readable in the tick it is set:
  // `start` closes over the value of its own render, so two clicks inside one would BOTH pass a
  // state check and create two conversations. The ref is what the guard actually reads.
  const startInFlightRef = useRef(false);
  // A dismiss that is asking the server whether it may let go. A ref, not state: it exists to stop
  // a second click issuing the same reads, and nothing on screen changes while it is set.
  const dismissInFlightRef = useRef(false);
  // What to tell the operator about a run this panel did not just start — the run a press found
  // instead of creating, or the one a dismiss could not let go of. Kept apart from `startError`,
  // which says why a PRESS was refused: neither of these is a refused press, and neither is a fault.
  const [notice, setNotice] = useState<string | null>(null);

  const { refresh, status, remoteStatus, commits, error } = controller;
  const projectId = project?.id ?? null;

  // Which ENDING a closing read belongs to. The session id alone is not enough: it identifies a
  // conversation, and a stale "already read that one" would let the next run's receipt be computed
  // from the reads of the last one. The press instant makes it this run's; the settling instant
  // makes it this ending's, so a late `complete` after a run stopped answering is read afresh.
  const runKey = pending && `${pending.sessionId}@${pending.startedAt}#${pending.settledAt}`;
  // The run whose closing read this panel has already asked for. A ref, because asking twice for
  // the same run is the thing it prevents and re-rendering is not.
  const refreshedForRef = useRef<string | null>(null);
  // Which run's closing read has LANDED. It is state rather than a ref because the derivation
  // below has to happen on a render that carries the refreshed payloads, not before it.
  const [readFor, setReadFor] = useState<string | null>(null);

  useEffect(() => {
    // Nothing is running HERE, but something may be running on the server — this document may have
    // been reloaded, opened second, or had its store re-evaluated by a hot update. Adopting the run
    // is what puts the card back on it instead of offering to start a second one.
    if (!projectId || busySessionIds.size === 0 || activeRun()) return undefined;
    let abandoned = false;
    // The polled set is only the trigger here — the answer is read fresh below. Failing to read is
    // not fatal on this path: nothing is adopted, and the press guard asks again for itself.
    void checkForLiveDelegationRun(projectId).then((check) => {
      if (abandoned || !check.known || !check.run || activeRun()) return;
      // Only a run started HERE is adopted. The check answers across every project now, and a run in
      // another one cannot be narrated from this panel's git — it is a reason to refuse a press,
      // which `start` handles, never a run for this card to claim as its own.
      if (check.run.projectId !== projectId) return;
      adoptRun({ projectId, sessionId: check.run.sessionId, startedAt: check.run.startedAt }, { sendMessage, subscribe });
    });
    return () => { abandoned = true; };
  }, [busySessionIds, projectId, sendMessage, subscribe]);

  useEffect(() => {
    // A run has ended and this is its repository: re-read git before saying anything about it.
    // The store deliberately does not do this itself — its publish notifies outside React's
    // batching, and the receipt would then be computed from the render before the read.
    if (!pending || !runKey || pending.projectId !== projectId) return;
    if (refreshedForRef.current === runKey) return;
    refreshedForRef.current = runKey;
    void refresh().then(() => setReadFor(runKey));
  }, [pending, projectId, refresh, runKey]);

  useEffect(() => {
    // The outcome, read off the controller state React has actually committed. A run that ended
    // while another repository was on screen waits here until this one is read again, so its
    // receipt is never computed from another repository's git.
    if (!pending || pending.projectId !== projectId || readFor !== runKey) return;
    if (status === null && error === null) return;
    // Remembered before it is drawn: the session lingers in the server's running list for a few
    // seconds after it ends, and adopting it back would put "● Claude is running" over the receipt.
    //
    // ⚠ Only for a run that is KNOWN over. "We stopped hearing from this run" is not "it ended" —
    // that banner is drawn precisely because the panel cannot tell — and marking it settled would
    // hide it from the server check, leaving nothing at all to refuse the press that duplicates it.
    if (!pending.lostConnection) markRunSettled(pending.sessionId);
    settleRun(deriveFinishedState(pending, { status, remoteStatus, commits }));
  }, [commits, error, pending, projectId, readFor, remoteStatus, runKey, status]);

  const start = useCallback(async () => {
    if (startInFlightRef.current) return;
    const busy = activeRun();
    // A run this document is still HEARING from is refused from memory — it watched it start, and
    // no read could say anything the frames have not already said. A run it stopped hearing from is
    // deliberately NOT refused here: memory cannot tell whether that one is over, and refusing on it
    // would leave the button dead for the life of the document. It falls through to the server.
    if (busy && !busy.unsettled) {
      setRefusal({ message: 'A run is already going. It commits and pushes every repository in the checkpoint, so there is only ever one — read that conversation before starting another.', sessionId: busy.sessionId });
      return;
    }
    if (!project) {
      // A press that cannot become a run says so rather than doing nothing: the conversation is
      // started IN a directory, and without one there is nothing to start it in.
      setRefusal({ message: 'This project has no folder on disk to run the command in.', sessionId: null });
      return;
    }
    if (!isConnected) {
      // The send is fire-and-forget — a closed socket drops the frame with a console warning and
      // nothing else. Refusing here is what stops a press becoming a card that reports a run the
      // server was never told to start (and an empty conversation with it).
      setRefusal({ message: 'There is no live connection to the server, so the command was not sent. Try again once it is back.', sessionId: null });
      return;
    }

    setRefusal(null);
    setNotice(null);
    startInFlightRef.current = true;
    setStarting(true);
    try {
      // Memory said nothing is running. The SERVER is asked before a second conversation is
      // created, because the run this press would duplicate may belong to another tab — and it is
      // asked FRESH, since a run reaches the poll behind the sidebar's chip up to five seconds late.
      const check = await checkForLiveDelegationRun(project.id);
      if (!check.known) {
        // An authorization that cannot be read is not an authorization. Refusing costs a retry;
        // proceeding costs two agents running `git add -A` over the same four working trees. The
        // copy sends the reader somewhere real, because this refusal can repeat.
        setRefusal({ message: "We couldn't check whether a run is already going, so nothing was started. Look for a running conversation in the sidebar, then try again.", sessionId: null });
        return;
      }
      if (check.run && check.run.projectId === project.id) {
        adoptRun({ projectId: project.id, sessionId: check.run.sessionId, startedAt: check.run.startedAt }, { sendMessage, subscribe });
        setNotice('This run was already going — nothing new was started. It commits and pushes every repository in the checkpoint, so there is only ever one.');
        return;
      }
      if (check.run) {
        // Started from ANOTHER project's panel — and `/git` commits and pushes every repository,
        // this one included, so it is still the run a second press would duplicate. It cannot be
        // adopted here: its receipt has to be read from the git of the repository it was started
        // from. So it is named, refused, and offered to be read.
        setRefusal({
          message: `A checkpoint is already running in ${describeProject(check.run.projectName)}. It commits and pushes every repository, this one included, so there is only ever one.`,
          sessionId: check.run.sessionId,
        });
        return;
      }

      const sessionId = await createDelegationSession(project.path);
      const upstream = describeUpstreamPosition(remoteStatus, status);
      beginRun(
        {
          projectId: project.id,
          sessionId,
          startedAt: Date.now(),
          aheadWhenStarted: upstream.kind === 'tracked' ? upstream.ahead : null,
        },
        { sendMessage, subscribe },
      );

      // Sent LAST, with the run already recorded above: the first frame it draws is then reduced
      // by the store rather than arriving for a run nothing is watching yet.
      sendDelegationPrompt(sessionId, sendMessage);
    } catch (cause) {
      console.error('Could not start the git delegation run:', cause);
      setRefusal({ message: cause instanceof Error ? cause.message : 'The conversation could not be started.', sessionId: null });
    } finally {
      startInFlightRef.current = false;
      setStarting(false);
    }
  }, [isConnected, project, remoteStatus, sendMessage, status, subscribe]);

  const dismiss = useCallback(async () => {
    // One question at a time. The ask below costs a read per running conversation, and a second
    // click would only buy the same answer twice.
    if (dismissInFlightRef.current) return;
    setRefusal(null);
    setNotice(null);
    const lost = activeRun();
    // An ordinary receipt is simply put away: its run ended, and the store let go of it then. The
    // one ending that needs asking about is a run this document stopped hearing from — and only
    // while it is THIS panel's, since that is the only run this card can be drawing a banner for.
    if (!lost?.unsettled || lost.projectId !== projectId) {
      dismissRun();
      return;
    }

    // "We stopped hearing from it" is not "it ended". Putting the CARD away is the operator's to
    // decide; letting go of the RUN is the server's, and it is asked here. Releasing a run that is
    // still committing and pushing four working trees would leave nothing to refuse the press that
    // starts a second one — and the banner this dismisses is drawn precisely because the panel
    // cannot tell. An unreadable answer holds, for the same reason the press refuses on one.
    dismissInFlightRef.current = true;
    const check = await checkForLiveDelegationRun(projectId).finally(() => {
      dismissInFlightRef.current = false;
    });
    // `going` separates the two ways there is nothing to keep holding: `null` is the server saying
    // no checkpoint is running anywhere, `undefined` is not having been able to ask.
    const going = check.known ? check.run : undefined;
    if (check.known && !going) {
      dismissRun();
      return;
    }
    dismissRun(false);
    setNotice(!going
      ? "We couldn't check whether that run has ended, so it is still being followed. Press again and we will look for it before starting anything."
      : going.sessionId === lost.sessionId
        ? 'That run is still going on the server, so it is still being followed — pressing again will show it rather than start a second one. There is only ever one checkpoint at a time.'
        : `A checkpoint is running in ${describeProject(going.projectName)}, so this card is kept until it ends. There is only ever one.`);
  }, [projectId]);

  // A run belongs to the repository it was started from, and only that panel narrates it — from
  // any other project this card offers a run instead of describing one it is not about. The run is
  // untouched by that: it is still in the store, still followed, and `start` still refuses while
  // it is going.
  const belongsHere = state.phase === 'idle' || state.projectId === projectId;
  const visibleState: GitDelegationState = belongsHere && state.phase !== 'idle'
    ? state
    : { phase: 'idle', startError: refusal?.message ?? null, blockedBySessionId: refusal?.sessionId ?? null };

  // The notice belongs to the run on screen; anywhere else it would be a sentence about nothing.
  return { state: visibleState, starting, notice: belongsHere ? notice : null, start, dismiss };
}
