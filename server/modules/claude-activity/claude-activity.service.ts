/**
 * The activity reading: is any Claude work in flight on this machine right now?
 *
 * One question, asked of four places, because no single place can answer it. A chat run is in the
 * run registry; a conversation that outlived a restart is in its session host's meta; a board's
 * Metis is in the Metis registry; and everything else — a dispatch soul, a plan-runner chain, a
 * terminal's own `claude` — is only visible as a process. Each leg answers with reasons, and the
 * answer is busy when any leg has one.
 *
 * THE ANSWER FAILS CLOSED. A leg that throws contributes a reason saying it could not be read, so an
 * unreadable process list, an unanswered tmux or a registry that is not up yet all read as busy. The
 * one consumer installs software under running conversations if this says idle wrongly, and loses
 * nothing if it says busy wrongly — the next reading is five minutes away.
 *
 * An IDLE session host does not count, on purpose: after a CLI install the idle-version sweep winds
 * those down and the next message starts them on the new binary. Its CLI is a `claude` process, so
 * the process leg drops the pids the live hosts own — a BUSY host is counted by the conversation leg
 * through `busyReason`, the sweep's own test, never a copy of it.
 */

import { countRunningMetisSessions } from '@/modules/kanban-metis/index.js';
import { busyReason, listLiveHosts } from '@/modules/providers/index.js';
import { chatRunRegistry } from '@/modules/websocket/index.js';
import type { ClaudeActivity } from '@/shared/claude-activity-types.js';

import { listClaudeProcessIds } from './claude-process-scan.js';

/** What kinds of process the "other Claude processes" reason names: the ones this server never
 *  registered as a turn, and that only the process list can see. */
const OTHER_PROCESS_EXAMPLES = 'dispatch souls, plan chains, terminals';

/** An error's own words, for the one place a failed leg becomes a sentence here. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** "1 thing is" / "2 things are" — the count and the verb agree, because these are read as sentences. */
function countPhrase(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular} is` : `${count} ${plural} are`;
}

/**
 * The conversations that are working, and the pids of every CLI a live session host owns.
 *
 * A conversation is named by its app session id in BOTH sources, so one in flight in the run registry
 * AND busy in its host's meta is counted once. The run registry is filtered to `claude` runs: another
 * provider's turn is not Claude work, and an update to Claude's packages cannot disturb it.
 */
function readConversations(): { working: Set<string>; hostCliPids: Set<number> } {
  const working = new Set<string>();
  for (const run of chatRunRegistry.listRunningRuns()) {
    if (run.provider === 'claude') working.add(run.sessionId);
  }

  const hostCliPids = new Set<number>();
  for (const host of listLiveHosts()) {
    if (host.cliPid !== null) hostCliPids.add(host.cliPid);
    if (busyReason(host) !== null) working.add(host.appSessionId);
  }
  return { working, hostCliPids };
}

/**
 * Whether any Claude work is in flight, with a plain sentence for each place that says so.
 *
 * Never rejects: every leg is read inside its own `try`, and one that cannot be read is a reason of
 * its own rather than an exception the caller has to know to treat as busy.
 *
 * consumer: the Claude updates module, injected from the server entrypoint — its automatic install
 * starts only when this answers idle, and its Updates tab shows the reasons while one waits.
 */
export async function readClaudeActivity(): Promise<ClaudeActivity> {
  const reasons: string[] = [];
  let hostCliPids = new Set<number>();

  try {
    const conversations = readConversations();
    hostCliPids = conversations.hostCliPids;
    if (conversations.working.size > 0) {
      reasons.push(`${countPhrase(conversations.working.size, 'Claude conversation', 'Claude conversations')} working`);
    }
  } catch (error) {
    reasons.push(`the Claude conversations could not be read: ${messageOf(error)}`);
  }

  try {
    const metisCount = countRunningMetisSessions();
    if (metisCount === null) reasons.push('the Metis sessions could not be counted yet');
    else if (metisCount > 0) reasons.push(`${countPhrase(metisCount, 'Metis session', 'Metis sessions')} running`);
  } catch (error) {
    reasons.push(`the Metis sessions could not be read: ${messageOf(error)}`);
  }

  try {
    // Read AFTER the hosts, so a host that started between the two reads is a pid this leg counts
    // rather than one it would wrongly drop — the wrong way for a race to fall is always "busy".
    const otherPids = (await listClaudeProcessIds()).filter((pid) => !hostCliPids.has(pid));
    if (otherPids.length > 0) {
      reasons.push(
        `${countPhrase(otherPids.length, 'other Claude process', 'other Claude processes')} running (${OTHER_PROCESS_EXAMPLES})`,
      );
    }
  } catch (error) {
    reasons.push(`the process list could not be read: ${messageOf(error)}`);
  }

  return { busy: reasons.length > 0, reasons };
}
