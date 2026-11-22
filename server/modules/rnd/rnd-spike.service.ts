import type { CommandDependencies } from '@/modules/dispatcher/index.js';
import { runVerb } from '@/modules/kanban-dispatch/index.js';

import { RND_REFUSAL_EXITS, readRndCandidate, type RndCandidate } from './rnd-state.service.js';

/**
 * Starting a spike from the R&D place: the chat that will run `/spike` on one candidate. In order, each step only once the
 * one before it answered: the candidate read (`rnd show --json <name>`), the model the launch table holds for `rnd.spike`,
 * the chat's session row, and then `rnd spike <name> --session <id>`, the dispatcher's own stamp. No step may leave a chat
 * nobody will use: a candidate already closed (rejected or adopted, which the stamp would refuse) is refused before the row
 * is made, the model is asked before it too, and when the stamp fails after the row exists the row is deleted again and
 * the dispatcher's sentence travels back.
 */

const STATUS_BAD_GATEWAY = 502;
const STATUS_CONFLICT = 409;

/** The words the dispatcher refuses a spike on (`store_rnd._refuse_closed`); the others are waiting, spiking and proved. */
const CLOSED_WORDS: readonly RndCandidate['word'][] = ['rejected', 'adopted'];

export type SpikeStart = { sessionId: string; prompt: string; model: string };
export type SpikeOutcome = { ok: true; value: SpikeStart } | { ok: false; status: number; error: string };

export type SpikeDependencies = {
  commands: CommandDependencies;
  /** The `rnd.spike` row's model, or the sentence saying why the table did not give one. */
  resolveModel: () => Promise<{ ok: true; model: string } | { ok: false; error: string }>;
  /** Makes the chat's session row for this project and prompt, and answers its id. */
  createSession: (projectPath: string, prompt: string) => string;
  /** Deletes a session row this service made, when the stamp it was made for did not land. */
  deleteSession: (sessionId: string) => void;
};

export async function startSpike(dependencies: SpikeDependencies, name: string, projectPath: string): Promise<SpikeOutcome> {
  const candidate = await readCandidate(dependencies.commands, name);
  if (!candidate.ok) return candidate;
  const { word } = candidate.value;
  if (CLOSED_WORDS.includes(word)) {
    const reopen = word === 'rejected' ? ` — dispatcher rnd reopen ${name} brings it back` : '';
    return { ok: false, status: STATUS_CONFLICT, error: `candidate ${name} is ${word}: a spike needs a waiting, spiking or proved candidate${reopen}` };
  }
  const model = await dependencies.resolveModel();
  if (!model.ok) return { ok: false, status: STATUS_BAD_GATEWAY, error: model.error };
  const prompt = spikePrompt(candidate.value);
  const sessionId = dependencies.createSession(projectPath, prompt);
  const stamped = await runVerb(dependencies.commands, ['rnd', 'spike', name, '--session', sessionId], RND_REFUSAL_EXITS);
  if (!stamped.ok) {
    dependencies.deleteSession(sessionId);
    return { ok: false, status: stamped.status, error: stamped.error };
  }
  return { ok: true, value: { sessionId, prompt, model: model.model } };
}

/** The `/spike` prompt: the question, a blank line, then the lines the skill reads the candidate from. */
export function spikePrompt(candidate: RndCandidate): string {
  return [
    `/spike ${candidate.question}`,
    '',
    `Candidate: ${candidate.name}`,
    `What it is: ${candidate.what}`,
    `Why it might help: ${candidate.why}`,
    `Source: ${candidate.source_url}`,
  ].join('\n');
}

async function readCandidate(
  commands: CommandDependencies,
  name: string,
): Promise<{ ok: true; value: RndCandidate } | { ok: false; status: number; error: string }> {
  const argv = ['rnd', 'show', '--json', name];
  const outcome = await runVerb(commands, argv, RND_REFUSAL_EXITS);
  if (!outcome.ok) return { ok: false, status: outcome.status, error: outcome.error };
  try {
    return { ok: true, value: readRndCandidate(JSON.parse(outcome.stdout), 'the candidate') };
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error);
    return { ok: false, status: STATUS_BAD_GATEWAY, error: `dispatcher ${argv.join(' ')} did not answer a candidate: ${said}` };
  }
}
