import { runDispatcherCommand, type DispatcherCommandDependencies } from '@/shared/dispatcher-command.js';
import type { RoadmapAct, RoadmapWriteResult } from '@/shared/roadmap-types.js';

/**
 * Running one write the fences have already turned into an argv, and labelling what the dispatcher said.
 *
 * The subprocess and its classification of how a command ended are `@/shared/dispatcher-command.ts`'s
 * (`runDispatcherCommand`): a refusal travels whole in `stdout`, untouched. What this file adds is the
 * act that was pressed and the NAME it acted on — the request's own, or, for an add that sent none,
 * the one the dispatcher minted. The screen sends no name on an add (the store is the one home of
 * whether a name is free, `store_roadmap.py`'s mint), so the name it selects afterwards is read back
 * from the dispatcher's own `ADDED <kind> <name>` line and from nowhere else.
 */

/**
 * The dispatcher's answer to an add: `ADDED <kind> <name>` and, after the name, the place the row
 * took (` — idea — epic #3`). The name class is the store's own (`store.NAME_RE`); anything else on the
 * line is the dispatcher's and is not read.
 */
const ADDED_LINE = /^ADDED (?:roadmap|milestone|arc|plan) ([a-z0-9][a-z0-9-]{0,99})(?=\s|$)/m;

/** The name the request itself carried, or `null`. The body already passed `writeArgv`, so a name in it is a well-formed one. */
function requestedName(body: unknown): string | null {
  const name = typeof body === 'object' && body !== null ? (body as { name?: unknown }).name : undefined;
  return typeof name === 'string' ? name : null;
}

/** The name an add minted, off its `ADDED` line — only an answer that is `ok` has one. */
function mintedName(stdout: string): string | null {
  return ADDED_LINE.exec(stdout)?.[1] ?? null;
}

/**
 * Runs one write's argv and answers `{ ...result, act, name }`. Never throws: `runDispatcherCommand`
 * resolves every way the dispatcher can fail to answer. `argv` is `writeArgv`'s, and `body` the request
 * it came from, read here only for the name. Consumer: `roadmap.module.ts`, which hands it to the routes.
 */
export async function relayRoadmapWrite(
  act: RoadmapAct,
  argv: readonly string[],
  body: unknown,
  dependencies: DispatcherCommandDependencies,
): Promise<RoadmapWriteResult> {
  const result = await runDispatcherCommand(argv, dependencies);
  const named = requestedName(body);
  const name = named ?? (act === 'add' && result.ok ? mintedName(result.stdout) : null);
  return { ...result, act, name };
}
