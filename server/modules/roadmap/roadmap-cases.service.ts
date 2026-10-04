import { readDispatcherJson, type DispatcherCommandDependencies } from '@/shared/dispatcher-command.js';
import { each, field, isRecord, isText, isTextOrNull, need, oneOf } from '@/shared/document-fields.js';
import type { RoadmapCase, RoadmapCaseWord } from '@/shared/roadmap-types.js';

/**
 * The roadmap lane's second read: one feature's active regression cases, asked of the cases door
 * (`~/.claude/scripts/cases`) when the feature dialog opens and never inside the poll. Nothing here
 * decides what a case's word means — `cases list` derives it from the case's newest run, and this
 * reads it against the closed vocabulary the contract states, refusing a body that does not read by
 * the field's path exactly as `roadmap-state.service.ts` does for the picture.
 *
 * Like the picture's read, a failure is ONE SENTENCE (`readDispatcherJson` throws it: "… exited 2:
 * REFUSED …", "… was stopped before it answered", "… did not answer") and the route hands that
 * sentence to the screen as the reason, unchanged.
 */

const CASE_WORDS: readonly RoadmapCaseWord[] = ['holding', 'broken', 'regressed', 'not run', "can't run"];

/**
 * How much the answer may weigh. A case is a sentence, a few paths and its newest run, about a
 * kilobyte, and a plan holds tens of them; a megabyte is hundreds of times that, stated rather than
 * left to `execFile`'s default for the reason `ROADMAP_MAX_BUFFER` is.
 */
const CASES_MAX_BUFFER = 1024 * 1024;

/** One item of the list, read field by field; `at` is its path (`cases[0]`) for the refusal. */
function readCase(raw: unknown, at: string, document: string): RoadmapCase {
  const where = (key: string): string => `${at}.${key}`;
  // A case no run has judged yet has no newest run: its two run fields are null, never absent.
  const newestRun = field(raw, 'newest_run');
  const run = newestRun === null || newestRun === undefined ? null : need(newestRun, isRecord, where('newest_run'), document);
  return {
    name: need(field(raw, 'name'), isText, where('name'), document),
    sentence: need(field(raw, 'sentence'), isText, where('sentence'), document),
    word: oneOf(field(raw, 'word'), CASE_WORDS, where('word'), document),
    last_run_at: run === null ? null : need(field(run, 'at') ?? null, isTextOrNull, where('newest_run.at'), document),
    last_saw: run === null ? null : need(field(run, 'saw') ?? null, isTextOrNull, where('newest_run.saw'), document),
  };
}

/**
 * The active cases of the plan named `feature`, one entry each. `feature` is the store's plan name,
 * already fenced by the route; `dependencies` carry the cases door's binary (the module composes them
 * beside the lane's own). Consumed by the roadmap module's composition root, which hands it to the
 * router's `GET /cases`.
 */
export async function readFeatureCases(
  dependencies: DispatcherCommandDependencies,
  feature: string,
): Promise<RoadmapCase[]> {
  const argv = ['list', '--plan', feature, '--state', 'active', '--json'];
  const document = `cases ${argv.join(' ')}`;
  const body = await readDispatcherJson(argv, dependencies, CASES_MAX_BUFFER);
  let index = 0;
  return each(body, 'cases', (entry) => readCase(entry, `cases[${index++}]`, document), document);
}
