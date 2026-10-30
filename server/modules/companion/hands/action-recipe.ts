import type { CompanionActionTarget, CompanionCeremonyAction, CompanionPendingAction } from '@/shared/companion-types.js';
import type { DispatcherAsk } from '@/shared/types.js';

import type { CompanionPin } from '../companion-pending.js';
import { openAsk } from '../eyes/card-lines.js';
import { bankDoor } from '../memory/bank-door.js';
import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { canBeNamed, wordsOf } from './action-word.js';
import { acceptHead, acceptPrompt, questionsPrompt, sayOf } from './action-prompts.js';
import { findCard, findChain, type CardFound } from './action-targets.js';
import { inOrderSaid, resolveCarriedLines } from './carried-lines.js';

/**
 * THE RECIPE OF EACH OF THE ELEVEN ACTIONS THAT WAIT FOR HIS WORD: what it takes, what it checks at prepare, what it pins and what she reads back. The
 * prepare is where an action is fixed to what he is shown: the target is resolved, the action is checked to be doable NOW (an
 * Accept prompt is open, the follow-up is open, the run is stopped), the ask and its lock token or the chain or the follow-up is
 * PINNED, and every line the action carries is checked to be one of his spoken lines of the last 30 minutes. (An open and a close
 * have no recipe: `direct-tools.ts` does them the moment he asks.) Nothing here moves
 * anything in the house: it answers a `PreparedAction` for `hands-tools.ts` to put on his panel, or the sentence that refuses and
 * says what to do next.
 *
 *   queue, hide, rework   a card with an open Accept prompt: pins `ask`. Hide with none open is the dispatcher's own hide of an
 *                         approved card; Rework with none open is a `tell` to its designer. Rework carries `words`, required.
 *   answer                a card with a questions round open: pins `ask`; `answers` holds a group per question number, and the
 *                         card gets one group per question of the round, an empty one for a question he left unanswered.
 *   show, recut, stop,    a card the dispatcher holds (Show: a hidden one).
 *   resume, kick
 *   resume_run            a chain whose record is not `running`, with `words` (his rulings), required: pins `chainId`.
 *   clear_memory          her own memory, named as such: reads her bank's count, pins nothing and carries nothing.
 *
 * Every pinned `ask` is the dispatcher picture's own `asking` at the moment of the prepare, so the order the door later sends is
 * for the prompt as he heard it read back, and a prompt that changed meanwhile is refused at the door, not carried.
 *
 * Consumer: `hands-tools.ts` (`prepare_action`).
 */

/** What `prepare_action` takes, past the zod parse. */
export type PrepareInput = {
  action: CompanionCeremonyAction;
  target: string;
  words?: string[];
  answers?: Array<{ question: number; words: string[] }>;
};

/** An action ready to go on his panel: the wire's fields, the pin the take will fire on, and what she reads back. */
type PreparedAction = Pick<CompanionPendingAction, 'target' | 'prompt' | 'carried' | 'say'> & { action: CompanionCeremonyAction; pin: CompanionPin; readBack: string };

/** A prepared action, or the sentence that refuses it and says what to do. */
type Preparation = { ok: true; prepared: PreparedAction } | { ok: false; sentence: string };

const refuse = (sentence: string): Preparation => ({ ok: false, sentence });

/** The extras a recipe adds to the plain fields: all optional except the read-back. */
type Extras = { pin?: CompanionPin; prompt?: string; carried?: PreparedAction['carried']; readBack: string };

function ready(action: CompanionCeremonyAction, target: CompanionActionTarget, extras: Extras): Preparation {
  return { ok: true, prepared: { action, target, pin: extras.pin ?? {}, prompt: extras.prompt ?? null, carried: extras.carried ?? [], say: sayOf(action, target.spoken), readBack: extras.readBack } };
}

/** His lines quoted for a read-back, in the order he said them. */
const quoted = (lines: ReadonlyArray<{ text: string }>): string => lines.map((line) => `"${line.text}"`).join(' ');

// ---------------------------

//----------------- THE CARD'S ACTIONS ------------

const isAccept = (ask: DispatcherAsk | null): ask is Extract<DispatcherAsk, { kind: 'accept' }> => ask?.kind === 'accept';

/** Whether the dispatcher holds the card hidden. */
function isHidden({ card }: Pick<CardFound, 'card'>): boolean {
  return card.kind === 'arc' ? card.dispatcherArc?.status === 'hidden' : card.plan?.status === 'hidden';
}

/** Whether the card is approved: a plan by its own record, an epic when any of its plans is. */
function isApproved({ card, book }: Pick<CardFound, 'card' | 'book'>): boolean {
  if (card.kind === 'plan') return card.plan?.approved != null;
  return (card.dispatcherArc?.plans ?? []).some((name) => book.plans.get(name)?.approved != null);
}

/** Whether the dispatcher holds the card at all (a shipped feature the dispatcher dropped is a roadmap row alone). */
const dispatcherHolds = ({ card }: Pick<CardFound, 'card'>): boolean => (card.kind === 'plan' ? card.plan !== null : card.dispatcherArc !== null);

/** Whether the card's work has finished: the dispatcher drops it a day on, and every verb on it is then meaningless. */
const isFinished = ({ card }: Pick<CardFound, 'card'>): boolean => (card.kind === 'plan' ? card.plan?.status === 'complete' : card.dispatcherArc?.status === 'complete');

/** `queue`, and the Hide that answers an open Accept: the card must have an Accept prompt open, and it is pinned. */
function prepareAtAccept(input: PrepareInput, found: CardFound): Preparation {
  const { action } = input;
  const { target, card, book } = found;
  const ask = openAsk(card, book);
  if (!isAccept(ask)) {
    const waiting = ask === null ? 'No prompt is open on it' : 'It has a questions round open, not an Accept';
    return refuse(`There is no Accept prompt open on ${target.spoken}. ${waiting}; read_card with scope prompt shows what it waits on.`);
  }
  const head = acceptHead(ask, book.plans.get(ask.plan)?.delivers ?? null);
  return ready(action, target, { pin: { ask }, prompt: acceptPrompt(ask), readBack: `${sayOf(action, target.spoken)}: ${head}.` });
}

function prepareHide(input: PrepareInput, found: CardFound): Preparation {
  const { target, card, book } = found;
  if (isAccept(openAsk(card, book))) return prepareAtAccept(input, found);
  if (!dispatcherHolds(found)) return refuse(`The dispatcher does not hold ${target.spoken} now, so there is nothing to hide.`);
  if (isHidden(found)) return refuse(`${target.spoken} is already hidden.`);
  if (!isApproved(found)) return refuse(`${target.spoken} is not approved and has no Accept prompt open, so there is nothing to hide; Hide holds an approved card out of the queue.`);
  return ready('hide', target, { readBack: `${sayOf('hide', target.spoken)}: it is approved, so this holds it out of the queue, paused, until he shows it.` });
}

function prepareShow(found: CardFound): Preparation {
  const { target } = found;
  if (!dispatcherHolds(found)) return refuse(`The dispatcher does not hold ${target.spoken} now, so there is nothing to show.`);
  if (!isHidden(found)) return refuse(`${target.spoken} is not hidden, so there is nothing to show.`);
  return ready('show', target, { readBack: `${sayOf('show', target.spoken)}: it is hidden now, and this puts it back in the queue.` });
}

function prepareRework(deps: CompanionToolDeps, input: PrepareInput, found: CardFound): Preparation {
  const { target, card, book } = found;
  if (input.words === undefined || input.words.length === 0) {
    return refuse('A Rework carries his notes, in his own spoken words. Ask him what to change, let him say it aloud, then prepare again with words: his lines exactly as he said them.');
  }
  const ask = openAsk(card, book);
  if (ask?.kind === 'questions') return refuse(`${target.spoken} has a questions round open, not an Accept; his answers go with answer, not rework.`);
  if (!isAccept(ask) && !dispatcherHolds(found)) return refuse(`The dispatcher does not hold ${target.spoken} now, so there is no designer to send notes to.`);
  const carried = resolveCarriedLines(deps.userId, input.words);
  if (!carried.ok) return refuse(carried.sentence);
  const lines = inOrderSaid(carried.lines);
  const notes = `with his notes: ${quoted(lines)}`;
  const base = { carried: [{ label: null, lines }] };
  if (isAccept(ask)) {
    const head = acceptHead(ask, book.plans.get(ask.plan)?.delivers ?? null);
    return ready('rework', target, { ...base, pin: { ask }, prompt: acceptPrompt(ask), readBack: `${sayOf('rework', target.spoken)} ${notes}; ${head}.` });
  }
  return ready('rework', target, { ...base, readBack: `${sayOf('rework', target.spoken)} ${notes}. There is no Accept prompt open, so the notes go to its designer as a message.` });
}

/** His answers to an open round as the card shows them: one group per question, in the round's order, empty where he gave none. */
function prepareAnswer(deps: CompanionToolDeps, input: PrepareInput, found: CardFound): Preparation {
  const { target, card, book } = found;
  const ask = openAsk(card, book);
  if (ask?.kind !== 'questions') return refuse(`No questions round is open on ${target.spoken}; read_card with scope questions shows whether there is one.`);
  const groups = input.answers ?? [];
  if (groups.length === 0) return refuse('An answer round carries his answers, in his own spoken words: one group per question, by its number. Read him the questions, let him answer aloud, then prepare again with answers.');
  const numbers = groups.map((group) => group.question);
  const outside = numbers.find((number) => number > ask.questions.length);
  if (outside !== undefined) return refuse(`${target.spoken} has ${ask.questions.length} ${ask.questions.length === 1 ? 'question' : 'questions'}; question ${outside} is not one of them.`);
  if (new Set(numbers).size !== numbers.length) return refuse('Each question is answered in one group: two groups name the same question number.');

  // One resolution across every group, so a line he said once answers one question and a line he said twice may answer two.
  const everything = groups.flatMap((group) => group.words);
  const carried = resolveCarriedLines(deps.userId, everything);
  if (!carried.ok) return refuse(carried.sentence);
  let next = 0;
  const answered = groups.map((group) => {
    const lines = inOrderSaid(carried.lines.slice(next, next + group.words.length));
    next += group.words.length;
    return { number: group.question, lines };
  }).sort((a, b) => a.number - b.number);

  // Every question of the round has its group, so one he left unanswered is on his card and in her read-back, not only in the
  // brief's "(no answer)".
  const round = ask.questions.map((_, index) => ({ number: index + 1, lines: answered.find((group) => group.number === index + 1)?.lines ?? [] }));
  const groupsOut = round.map(({ number, lines }) => ({ label: ask.questions[number - 1].text, lines }));
  const told = round.map(({ number, lines }) => `question ${number}, ${lines.length === 0 ? 'no answer' : quoted(lines)}`).join('; ');
  // The pin keeps each group's question number, so the brief puts a group under the question it answers even when two read alike.
  const pin = { ask, questions: round.map(({ number }) => number) };
  return ready('answer', target, { pin, prompt: questionsPrompt(ask), carried: groupsOut, readBack: `${sayOf('answer', target.spoken)}: ${told}.` });
}

/** `recut`, `stop`, `resume` and `kick`: a card the dispatcher holds. */
function prepareVerb(input: PrepareInput, found: CardFound): Preparation {
  const { action } = input;
  const { target } = found;
  if (!dispatcherHolds(found)) return refuse(`The dispatcher does not hold ${target.spoken} now; ${action} acts on a card it holds.`);
  if (action !== 'kick' && isFinished(found)) return refuse(`${target.spoken} has finished, so there is nothing to ${action}.`);
  const meaning: Partial<Record<CompanionCeremonyAction, string>> = {
    recut: 'this sends its design to be cut into tasks again',
    stop: 'this pauses it and ends its running work',
    resume: 'this lets it run again',
    kick: 'this wakes the dispatcher',
  };
  return ready(action, target, { readBack: `${sayOf(action, target.spoken)}: ${meaning[action]}.` });
}

// ---------------------------

//----------------- THE REST ------------

async function prepareResumeRun(deps: CompanionToolDeps, input: PrepareInput): Promise<Preparation> {
  if (input.words === undefined || input.words.length === 0) {
    return refuse('A resumed run carries his rulings, in his own spoken words. Ask him what to rule, let him say it aloud, then prepare again with words: his lines exactly as he said them.');
  }
  const chain = await findChain(deps.house, input.target);
  if (!chain.ok) return refuse(chain.sentence);
  const { target, status } = chain.value;
  if (status === 'running') return refuse(`${target.spoken} is still running, so there is nothing to resume.`);
  if (status === 'done' || status === 'nothing-changed') return refuse(`${target.spoken} finished; a finished run is not resumed.`);
  const carried = resolveCarriedLines(deps.userId, input.words);
  if (!carried.ok) return refuse(carried.sentence);
  const lines = inOrderSaid(carried.lines);
  return ready('resume_run', target, {
    pin: { chainId: target.runId },
    carried: [{ label: null, lines }],
    readBack: `${sayOf('resume_run', target.spoken)} with his rulings: ${quoted(lines)}.`,
  });
}

/**
 * `clear_memory`: her whole bank, which only his spoken word clears. The target must name her memory ("memory", "your memory"), and
 * the count is read from the bank itself so the card and her read-back say how many she would forget. An empty bank has nothing to
 * clear, and a door that does not answer is a refusal, not a card that fires into the dark.
 */
async function prepareClearMemory(input: PrepareInput): Promise<Preparation> {
  if (!wordsOf(input.target).includes('memory')) return refuse('clear_memory acts on your memory alone; name it as your memory.');
  const listed = await bankDoor.list();
  if (!listed.ok) return refuse(`Your memory can't be reached just now: ${listed.sentence.replace(/[.!?]+$/, '')}.`);
  const count = listed.value.length;
  if (count === 0) return refuse('There is nothing to clear.');
  const target: CompanionActionTarget = { kind: 'memory', spoken: 'your memory', count };
  const things = `${count} ${count === 1 ? 'thing' : 'things'}`;
  return ready('clear_memory', target, {
    prompt: `She forgets the ${things} she keeps. The docstore's history keeps them.`,
    readBack: `${sayOf('clear_memory', target.spoken)}: you forget the ${things} you keep; the docstore's history keeps them, and the conversation is not touched.`,
  });
}

/** The actions that take no `words` (an answer round's lines go in `answers`): given any, the prepare refuses rather than let her believe they travelled. */
const TAKES_NO_WORDS: ReadonlySet<CompanionCeremonyAction> = new Set(['queue', 'hide', 'show', 'answer', 'recut', 'stop', 'resume', 'kick', 'clear_memory']);

/**
 * The prepare of one action: its target resolved, its checks made, its pin taken and its lines carried, or the sentence that
 * refuses. A target no line of his could ever name (every word of it is the action's own or a filler word) is refused here, at
 * once, instead of going on his panel to lapse unsaid. Consumed by `hands-tools.ts` (`prepare_action`).
 */
export async function prepareRecipe(deps: CompanionToolDeps, input: PrepareInput): Promise<Preparation> {
  const { action } = input;
  if (TAKES_NO_WORDS.has(action) && input.words !== undefined) {
    return refuse(action === 'answer' ? 'answer carries his lines in answers, one group per question; words are not taken. Leave words out.' : `${action} carries no words of his; leave words out.`);
  }
  if (action !== 'answer' && input.answers !== undefined) return refuse(`Only answer carries answers; ${action} does not. Leave answers out.`);

  let prepared: Preparation;
  if (action === 'resume_run') {
    prepared = await prepareResumeRun(deps, input);
  } else if (action === 'clear_memory') {
    prepared = await prepareClearMemory(input);
  } else {
    const found = await findCard(deps.house, input.target);
    if (!found.ok) return refuse(found.sentence);
    if (action === 'queue') prepared = prepareAtAccept(input, found.value);
    else if (action === 'hide') prepared = prepareHide(input, found.value);
    else if (action === 'show') prepared = prepareShow(found.value);
    else if (action === 'rework') prepared = prepareRework(deps, input, found.value);
    else if (action === 'answer') prepared = prepareAnswer(deps, input, found.value);
    else prepared = prepareVerb(input, found.value);
  }
  if (prepared.ok && !canBeNamed(prepared.prepared.target, action)) {
    return refuse(`No line of his can fire this: "${prepared.prepared.target.spoken}" has no word of its own that is not the action itself or a filler word. Tell him it cannot be done by voice.`);
  }
  return prepared;
}
