import { readChainRun, readChainsHoldingLaunches, type ChainRun } from '@/modules/dispatch-souls/index.js';
import { sessionsDb } from '@/modules/database/index.js';
import type { RoadmapPicture } from '@/shared/roadmap-types.js';
import type { SoulLaunchSnapshot } from '@/shared/types.js';

import type { CompanionHouse } from '../house.js';
import { chatNameOf } from '../tools/house-reads.js';

import { whenWords } from './eyes-answer.js';
import { clipText } from './run-scrub.js';
import { chainState, soulState, type RunState } from './run-state.js';

/**
 * THE RUNS, GATHERED AND SAID — the readers behind `list_runs`. A run is one of two things, and the list prints both with the
 * id she passes back to `read_run`:
 *   - a DISPATCHER run: the chain of one task (`phase.chain_id`) of a plan in the dispatcher's picture, said
 *     `<plan title> › <task title> · <state> · <when> · run <chain id>`. The picture holds every plan that is open or finished
 *     in the last 24 hours, so every recent dispatcher run is in it; the chain's own record says how it stands (`readChainRun`).
 *   - a CHAT's run: a soul or a chain a chat launched by hand, from the souls lane (`dispatcher_work` false), said
 *     `<chat name> › <agent> "<brief's first six words>" · <state> · <when> · run <id>`. The lane carries one row per launch,
 *     and a chain's stages are launches; the chain's record is what joins them, so a chat's chain is ONE run (its chain id) and
 *     a soul no chain holds is one (its launch id). The lane keeps an ended launch six hours, so a chat's older runs are gone.
 *
 * NEVER A COST (ruling 1): the lines carry no spend, tokens, provider or runtime. This file reads the houses' pictures and the
 * launcher's records and writes nothing. Consumers: `run-reads.ts` (`list_runs`) and `run-resolve.ts` (the `<plan> <task>` form).
 */

/** The cap of a run list: a line each, and the rest named by count. */
export const RUNS_MAX = 15;

const RECENT_S = 24 * 60 * 60;
const FAILED_S = 7 * 24 * 60 * 60;

/** How far back a chat's chain record is looked for: the lane's six-hour keep, and a minute for the walker's save after a launch. */
const HAND_CHAIN_WINDOW_S = 6 * 60 * 60 + 60;

/** How many words of a brief the chat's line quotes, and the most characters of a task title the dispatcher's line prints. */
const BRIEF_WORDS = 6;
const TASK_TITLE_MAX = 70;

/** One run as the list holds it (private to this file): its id, its printed line, its state, when it last moved (epoch SECONDS) and the lower-case text a phrase is searched in. */
type RunItem = { id: string; kind: 'chain' | 'soul'; line: string; state: RunState; at: number; haystack: string };

/** The scope words of `list_runs`; any other scope is a phrase. Consumed through `runScopeOf` and `runLines`. */
type RunScope = { kind: 'running' | 'recent' | 'failed' } | { kind: 'phrase'; phrase: string };

/** `seconds` when a date can be made of it, else `null`: a stamp is a finite number, but a finite number is not always a date (`new Date(1e20 * 1000)` is invalid and `toISOString` throws on it). */
function dateable(seconds: number | null): number | null {
  return seconds !== null && Number.isFinite(new Date(seconds * 1000).getTime()) ? seconds : null;
}

/**
 * An epoch-seconds moment as he would say it ("today 14:02"); "at an unknown time" for none, or for one no date can be made of, so a single
 * torn record never costs a whole list or a whole read. Consumed by this file's lines and by `run-scopes.ts`' heads and stage lines.
 */
export function momentWords(seconds: number | null): string {
  const sane = dateable(seconds);
  return sane === null ? 'at an unknown time' : whenWords(new Date(sane * 1000).toISOString());
}

/**
 * Every plan's title on the roadmap, by the plan's name — the feature's title where the roadmap holds the plan, which is how
 * the Roadmap tab names it. A plan the roadmap does not hold (or a roadmap not read yet) is not here, and its name stands.
 * Consumed by `run-resolve.ts`, which matches a spoken plan against names and titles alike.
 */
export function planTitles(roadmap: RoadmapPicture | null): Map<string, string> {
  const titles = new Map<string, string>();
  if (roadmap === null) return titles;
  for (const feature of roadmap.unplaced.features) titles.set(feature.name, feature.title);
  for (const board of roadmap.roadmaps) {
    for (const milestone of board.milestones) {
      for (const epic of milestone.epics) {
        for (const feature of epic.features) titles.set(feature.name, feature.title);
      }
    }
  }
  return titles;
}

/** The time a run's line ends on: since when it is out, or when it ended. */
function whenOf(state: RunState, startedAt: number | null, endedAt: number | null, updatedAt: number | null, nowS: number): { at: number; words: string } {
  const start = dateable(startedAt) ?? dateable(updatedAt) ?? nowS;
  if (state.kind === 'running') return { at: start, words: `since ${momentWords(start)}` };
  const end = dateable(endedAt) ?? dateable(updatedAt) ?? start;
  return { at: end, words: momentWords(end) };
}

/** The name of the chat a CLI session id stands for: the sidebar's name for its app row; a chat that is gone, or no stamp at all, is said so. */
function chatNameForStamp(cliSessionId: string | null): string {
  if (cliSessionId === null) return 'a run no chat launched';
  const appSessionId = sessionsDb.resolveAppSessionId(cliSessionId);
  return sessionsDb.getSessionById(appSessionId) ? chatNameOf(appSessionId) : 'a chat that is gone';
}

/** The first `BRIEF_WORDS` words of a brief. */
const briefWords = (brief: string): string => brief.split(/\s+/).filter((word) => word !== '').slice(0, BRIEF_WORDS).join(' ');

/** The dispatcher's runs: one per task whose phase carries a chain, in the picture's order. Done phases are read only when the scope can show one. */
function dispatcherRuns(picture: NonNullable<Awaited<ReturnType<CompanionHouse['dispatcher']>>>, titles: Map<string, string>, nowS: number, includeDone: boolean): RunItem[] {
  const items: RunItem[] = [];
  for (const plan of picture.plans) {
    const planTitle = titles.get(plan.name) ?? plan.name;
    for (const phase of plan.phases) {
      if (phase.chain_id === null) continue;
      if (phase.status === 'done') {
        const doneAt = phase.done_at === null ? Number.NaN : Date.parse(phase.done_at) / 1000;
        if (!includeDone || (Number.isFinite(doneAt) && nowS - doneAt > FAILED_S)) continue;
      }
      const chain: ChainRun | null = readChainRun(phase.chain_id, { summaryOnly: true });
      if (chain === null) continue;
      const state = chainState(chain, nowS);
      const when = whenOf(state, chain.started_at, chain.ended_at, chain.updated_at, nowS);
      items.push({
        id: chain.chain_id,
        kind: 'chain',
        line: `${planTitle} › ${clipText(phase.title, TASK_TITLE_MAX)} · ${state.words} · ${when.words} · run ${chain.chain_id}`,
        state,
        at: when.at,
        haystack: [plan.name, planTitle, phase.key, phase.title, chain.agent, chain.slug].join(' ').toLowerCase(),
      });
    }
  }
  return items;
}

/** A chat's runs: its chains as one run each (the lane's rows joined by the chains' records), and its souls alone as one each. */
function chatRuns(launches: SoulLaunchSnapshot[], nowS: number): RunItem[] {
  const hand = launches.filter((launch) => !launch.dispatcher_work);
  const chainOf = readChainsHoldingLaunches(new Set(hand.map((launch) => launch.launch_id)), (nowS - HAND_CHAIN_WINDOW_S) * 1000);
  const byChain = new Map<string, SoulLaunchSnapshot[]>();
  const alone: SoulLaunchSnapshot[] = [];
  for (const launch of hand) {
    const chainId = chainOf.get(launch.launch_id);
    if (chainId === undefined) alone.push(launch);
    else byChain.set(chainId, [...(byChain.get(chainId) ?? []), launch]);
  }

  const items: RunItem[] = [];
  for (const [chainId, group] of byChain) {
    const chain = readChainRun(chainId, { summaryOnly: true });
    if (chain === null) continue;
    const first = [...group].sort((a, b) => a.started_at - b.started_at)[0];
    items.push(chatRunItem({ id: chainId, kind: 'chain', agent: chain.agent || first.agent, brief: first.brief, stamp: first.launched_by, state: chainState(chain, nowS), startedAt: chain.started_at, endedAt: chain.ended_at, updatedAt: chain.updated_at }, nowS));
  }
  for (const launch of alone) {
    items.push(chatRunItem({ id: launch.launch_id, kind: 'soul', agent: launch.agent, brief: launch.brief, stamp: launch.launched_by, state: soulState(launch.role, launch.state), startedAt: launch.started_at, endedAt: launch.ended_at, updatedAt: null }, nowS));
  }
  return items;
}

/** One chat's run as a list item: the line `<chat> › <agent> "<six words>" · <state> · <when> · run <id>`. */
function chatRunItem(run: { id: string; kind: 'chain' | 'soul'; agent: string; brief: string; stamp: string | null; state: RunState; startedAt: number | null; endedAt: number | null; updatedAt: number | null }, nowS: number): RunItem {
  const chat = chatNameForStamp(run.stamp);
  const when = whenOf(run.state, run.startedAt, run.endedAt, run.updatedAt, nowS);
  const quoted = briefWords(run.brief);
  return {
    id: run.id,
    kind: run.kind,
    line: `${chat} › ${run.agent} "${quoted}" · ${run.state.words} · ${when.words} · run ${run.id}`,
    state: run.state,
    at: when.at,
    haystack: [chat, run.agent, run.brief].join(' ').toLowerCase(),
  };
}

/** `scope` as the keyword it is, or the phrase it is not: the three words match without regard to case. */
export function runScopeOf(scope: string): RunScope {
  const word = scope.trim().toLowerCase();
  return word === 'running' || word === 'recent' || word === 'failed' ? { kind: word } : { kind: 'phrase', phrase: scope.trim() };
}

/** Whether a run belongs to the scope: out now; ended in the last day; ended without finishing in the last week; or holding the phrase. */
function inScope(item: RunItem, scope: RunScope, nowS: number): boolean {
  switch (scope.kind) {
    case 'running':
      return item.state.kind === 'running';
    case 'recent':
      return item.state.kind !== 'running' && nowS - item.at <= RECENT_S;
    case 'failed':
      return (item.state.kind === 'bad' || item.state.kind === 'waiting') && nowS - item.at <= FAILED_S;
    default:
      return item.haystack.includes(scope.phrase.toLowerCase());
  }
}

/**
 * The sentence for a scope that holds nothing. A chat's own runs come from the souls lane, which keeps an ended launch six hours, so a
 * day's or a week's "none" says so; and when a source has not been read yet this boot the sentence claims nothing about the whole.
 */
function noneSentence(scope: RunScope, partial: boolean): string {
  if (partial) return 'Nothing among the runs that could be read yet; ask again in a moment for the rest.';
  switch (scope.kind) {
    case 'running':
      return 'Nothing is running right now: no plan task and no chat run is out.';
    case 'recent':
      return "No run ended in the last 24 hours (a chat's own runs are kept for six hours).";
    case 'failed':
      return "No run ended badly in the last 7 days (a chat's own runs are kept for six hours).";
    default:
      return `No run matches "${scope.phrase}"; list_runs recent shows the latest.`;
  }
}

/**
 * The runs of a scope, newest first (the ones still out come first), as the lines `list_runs` prints, with the sentence for an
 * empty scope and the notes for a source that has not been read this boot. Reads `house.dispatcher()`, `house.roadmap()` (for plan
 * titles) and `house.launches()` once each, then the launcher's records for the chains it names.
 * Consumed by `run-reads.ts`.
 */
export async function runLines(house: CompanionHouse, scope: RunScope, nowS: number): Promise<{ lines: string[]; notes: string[]; none: string }> {
  const [dispatcher, roadmap, launches] = await Promise.all([house.dispatcher(), house.roadmap(), house.launches()]);
  const notes: string[] = [];
  if (dispatcher === null) notes.push("The dispatcher's runs have not been read yet this boot; only the chats' runs are listed.");
  if (launches === null) notes.push("The chats' runs have not been read yet this boot; only the dispatcher's runs are listed.");

  const includeDone = scope.kind === 'recent' || scope.kind === 'phrase';
  const items = [
    ...(dispatcher === null ? [] : dispatcherRuns(dispatcher, planTitles(roadmap), nowS, includeDone)),
    ...(launches === null ? [] : chatRuns(launches, nowS)),
  ].filter((item) => inScope(item, scope, nowS));
  // Out now first, then the newest ending; a stable sort keeps the picture's order inside a tie.
  items.sort((a, b) => Number(b.state.kind === 'running') - Number(a.state.kind === 'running') || b.at - a.at);
  return { lines: items.map((item) => item.line), notes, none: noneSentence(scope, notes.length > 0) };
}
