import { readChainRun, readSoulRun } from '@/modules/dispatch-souls/index.js';
import { sessionsDb } from '@/modules/database/index.js';
import type { DispatcherPhase, DispatcherPlan } from '@/shared/types.js';

import type { CompanionHouse } from '../house.js';

import { planTitles } from './run-list.js';

/**
 * THE RUN RESOLUTION — which run a spoken or printed reference names. A run is named by:
 *   - the id `list_runs` prints (`run chain-…` for a chain, `run dispatch-…` for a soul alone), checked against the launcher's
 *     own records, or
 *   - `<plan> <task key or title>` (a plan by its name or its title on the roadmap, dashes read as spaces; the task by its key,
 *     its title, a part of its title of three characters or more, or its number in the plan), which is that task's `chain_id`.
 *     `<plan title> › <task title>` as the list prints it works the same way.
 * One match is the answer; several or none is a refusal that names the candidates, so she asks him, or reads the list again.
 *
 * It reads `house.dispatcher()` and `house.roadmap()` for the plan form only, and the launcher's records for an id. It moves no
 * focus and no activity. Consumers: `run-reads.ts` (`read_run`) and the hands' `action-recipe.ts` (`resume_run` and `open` take a
 * run through `resolveRun`: a chain's `plan` is the card an open lands on, its `chatSessionId` the chat).
 */

/** The most candidates a refusal names. */
const CANDIDATES_MAX = 8;

/** Words that carry no task in a spoken reference ("the run-reads task of …"). */
const FILLER = new Set(['the', 'a', 'of', 'task', 'phase', 'run', 'for', 'in', 'on']);

/**
 * A run resolved. `plan` is the dispatcher plan the run belongs to (a chain that is a task's run), else `null`; `chatSessionId`
 * is the APP id of the chat that launched a run by hand (a chat's chain or soul whose chat still exists), else `null` — a
 * dispatcher run's plan is where an open of it lands, a chat's run's chat is. `task` is the plan's task for a dispatcher run.
 * Consumed by `run-reads.ts` and the hands' `action-recipe.ts` and `action-doors.ts`.
 */
export type ResolvedRun = {
  kind: 'chain' | 'soul';
  id: string;
  plan: string | null;
  task: { key: string; title: string } | null;
  chatSessionId: string | null;
};

/** The answer of `resolveRun`: the run, or the sentence that says what to do next. Consumed by `read_run` and the hands. */
export type RunResolution = { ok: true; run: ResolvedRun } | { ok: false; sentence: string };

/** Text as compared: lower case, every run of dashes, underscores, spaces and punctuation one space. */
const folded = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The app id of the chat a CLI session id stands for, or `null` when it names no chat of this house. */
function appChatOf(cliSessionId: string | null): string | null {
  if (cliSessionId === null) return null;
  const appSessionId = sessionsDb.resolveAppSessionId(cliSessionId);
  return sessionsDb.getSessionById(appSessionId) ? appSessionId : null;
}

type Picture = NonNullable<Awaited<ReturnType<CompanionHouse['dispatcher']>>>;

/** The plan task a chain id is the run of, in the picture. */
function taskOfChain(picture: Picture | null, chainId: string): { plan: DispatcherPlan; phase: DispatcherPhase } | null {
  for (const plan of picture?.plans ?? []) {
    const phase = plan.phases.find((candidate) => candidate.chain_id === chainId);
    if (phase !== undefined) return { plan, phase };
  }
  return null;
}

/**
 * An id the launcher's records hold: a chain (a dispatcher task's, or a chat's), else a soul alone; `null` when neither exists. A
 * dispatcher task's own chain id resolves even when its record has been cleared from disk (the picture keeps every task's `chain_id`
 * and the card prints it): the run is real, and the read of it says its files are gone.
 */
function runOfId(picture: Picture | null, id: string): ResolvedRun | null {
  const chain = readChainRun(id, { summaryOnly: true });
  const task = taskOfChain(picture, id);
  if (task !== null) return { kind: 'chain', id, plan: task.plan.name, task: { key: task.phase.key, title: task.phase.title }, chatSessionId: null };
  if (chain !== null) {
    const stamp = chain.stages.map((stage) => (stage.launch === null ? null : readSoulRun(stage.launch)?.launched_by ?? null)).find((found) => found !== null) ?? null;
    return { kind: 'chain', id, plan: null, task: null, chatSessionId: appChatOf(stamp) };
  }
  const soul = readSoulRun(id);
  return soul === null ? null : { kind: 'soul', id, plan: null, task: null, chatSessionId: appChatOf(soul.launched_by) };
}

/** `key (title)` for each task, at most eight, for a refusal. */
const describeTasks = (phases: DispatcherPhase[]): string =>
  phases.slice(0, CANDIDATES_MAX).map((phase) => `${phase.key} (${phase.title.slice(0, 60)})`).join('; ') + (phases.length > CANDIDATES_MAX ? `; and ${phases.length - CANDIDATES_MAX} more` : '');

/** The plans of the picture that have tasks, by the names a person says them: the plan's name and its roadmap title, folded. A plan none of whose tasks has launched is here too, so a task asked for before its run exists is answered as not started. */
function plansWithTasks(picture: Picture, titles: Map<string, string>): Array<{ plan: DispatcherPlan; names: string[] }> {
  return picture.plans
    .filter((plan) => plan.phases.length > 0)
    .map((plan) => ({ plan, names: [folded(plan.name), folded(titles.get(plan.name) ?? '')].filter((name) => name !== '') }));
}

/**
 * Splits a reference into the plan it names and the words left for the task: `<plan> › <task>` at the arrow, else the plan whose
 * name or title the folded reference starts with (the longest wins), else one it merely holds as whole words. `null` when no plan
 * is named, which is the caller's refusal.
 */
function planAndTaskWords(reference: string, plans: Array<{ plan: DispatcherPlan; names: string[] }>): { plan: DispatcherPlan; rest: string } | null {
  const arrow = reference.split('›');
  const left = folded(arrow[0] ?? '');
  const right = arrow.length > 1 ? folded(arrow.slice(1).join(' ')) : null;
  const text = right === null ? folded(reference) : left;
  let best: { plan: DispatcherPlan; rest: string; length: number } | null = null;
  for (const { plan, names } of plans) {
    for (const name of names) {
      const padded = ` ${text} `;
      const at = padded.indexOf(` ${name} `);
      if (at < 0 || (right !== null && text !== name)) continue;
      // A name the reference STARTS with is the plan; one it only holds is the plan too, with the words around it left for the task.
      const rest = `${padded.slice(0, at)} ${padded.slice(at + name.length + 2)}`.replace(/\s+/g, ' ').trim();
      if (best === null || name.length > best.length) best = { plan, rest: right ?? rest, length: name.length };
    }
  }
  return best === null ? null : { plan: best.plan, rest: best.rest };
}

/** `words` without the filler words at either end ("the run-reads task" → "run-reads"); the words inside a title are never touched. */
function withoutEdgeFiller(words: string): string {
  const parts = words.split(' ');
  while (parts.length > 0 && FILLER.has(parts[0])) parts.shift();
  while (parts.length > 0 && FILLER.has(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

/** The tasks among `phases` that `wanted` names: its key or title exactly, else a part of its title or key (three characters or more). */
function tasksNamed(phases: DispatcherPhase[], wanted: string): DispatcherPhase[] {
  const exact = phases.filter((phase) => folded(phase.key) === wanted || folded(phase.title) === wanted);
  if (exact.length > 0 || wanted.length < 3) return exact;
  return phases.filter((phase) => folded(phase.title).includes(wanted) || folded(phase.key).includes(wanted));
}

/**
 * The task of a plan that the words name: its key, its title, a part of its title or key (three characters or more), or its number, among
 * ALL the plan's tasks. A task that has not launched is named like any other and answered as not started — never swapped for another
 * task whose title happens to hold the word. The words are tried as said first (a task whose key is "run" is named "run"), and with the
 * filler at their ends cut ("the run-reads task") only when that finds nothing.
 */
function pickTask(plan: DispatcherPlan, words: string): { ok: true; phase: DispatcherPhase } | { ok: false; sentence: string } {
  const withRuns = plan.phases.filter((phase) => phase.chain_id !== null);
  const trimmed = withoutEdgeFiller(words);
  const numbered = /^\d+$/.test(trimmed) ? plan.phases[Number(trimmed) - 1] : undefined;
  const found = [tasksNamed(plan.phases, words), trimmed === '' ? [] : tasksNamed(plan.phases, trimmed), numbered === undefined ? [] : [numbered]].find((candidates) => candidates.length > 0) ?? [];

  if (found.length === 0 && trimmed === '') {
    if (withRuns.length === 0) return { ok: false, sentence: `${plan.name} has no task with a run yet.` };
    if (withRuns.length === 1) return { ok: true, phase: withRuns[0] };
    const out = withRuns.filter((phase) => phase.status !== 'done');
    if (out.length === 1) return { ok: true, phase: out[0] };
    return { ok: false, sentence: `${plan.name} has ${withRuns.length} tasks with runs: ${describeTasks(withRuns)}. Name the task by its key or title.` };
  }
  if (found.length > 1) return { ok: false, sentence: `"${words}" fits ${found.length} tasks of ${plan.name}: ${describeTasks(found)}. Name one by its key.` };
  if (found.length === 0) return { ok: false, sentence: `${plan.name} has no task named "${words}". Its tasks: ${describeTasks(plan.phases)}.` };
  const [task] = found;
  if (task.chain_id === null) return { ok: false, sentence: `The task ${task.key} of ${plan.name} (${task.title.slice(0, 60)}) has no run yet: it is ${task.status}.` };
  return { ok: true, phase: task };
}

/**
 * The run a reference names: an id of the launcher's records (a chain's or a soul's), or `<plan> <task key or title>` for a
 * dispatcher task's chain. A refusal says what to do next (read `list_runs` and pass the id it prints, or name the task).
 * Consumed by `run-reads.ts` (`read_run`) and by the hands' recipe and doors, which resolve `resume_run` and `open` targets through it.
 */
export async function resolveRun(house: CompanionHouse, reference: string): Promise<RunResolution> {
  const wanted = reference.trim();
  if (wanted === '') return { ok: false, sentence: 'Name the run by the id list_runs prints, or by its plan and task.' };
  const picture = await house.dispatcher();

  // An id first: both reads hold the id to the launcher's fence, so a phrase with a space or a path is never a record.
  const byId = runOfId(picture, wanted);
  if (byId !== null) return { ok: true, run: byId };

  if (picture === null) {
    return { ok: false, sentence: `"${wanted}" is not a run id, and the dispatcher has not been read yet this boot, so a plan and task cannot be matched. Call list_runs for the id, or ask again in a moment.` };
  }
  const plans = plansWithTasks(picture, planTitles(await house.roadmap()));
  const named = planAndTaskWords(wanted, plans);
  if (named === null) {
    return { ok: false, sentence: `No run is recorded as "${wanted}", and no plan with tasks is named in it. Call list_runs for the run's id, or name the plan and its task.` };
  }
  const task = pickTask(named.plan, folded(named.rest));
  if (!task.ok) return { ok: false, sentence: task.sentence };
  return {
    ok: true,
    run: { kind: 'chain', id: task.phase.chain_id as string, plan: named.plan.name, task: { key: task.phase.key, title: task.phase.title }, chatSessionId: null },
  };
}
