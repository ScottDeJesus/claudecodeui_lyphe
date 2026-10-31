import { readChainRun } from '@/modules/dispatch-souls/index.js';
import { findFollowupForAccount } from '@/modules/followups/index.js';
import type { CompanionActionTarget, CompanionOpenTarget } from '@/shared/companion-types.js';

import { buildCardBook, type Card, type CardBook } from '../eyes/card-lines.js';
import { checkName, choiceLines, findChecksToOpen, withoutUsageChecks } from '../eyes/cerberus-lines.js';
import { resolvePage } from '../eyes/docspace-client.js';
import { resolveCard } from '../eyes/roadmap-reads.js';
import { resolveRun } from '../eyes/run-resolve.js';
import type { CompanionHouse } from '../house.js';
import { resolveChat } from '../tools/house-reads.js';

/**
 * WHAT AN ACTION ACTS ON: the resolution of the target string she passes to `prepare_action`, `open` or `close_followup` into the wire's
 * `CompanionActionTarget`, through the same resolvers her eyes use (a card through `resolveCard`, a run through `resolveRun`,
 * a page through `resolvePage`, a chat through `resolveChat`, a check through `findChecksToOpen` over the Cerberus overview with the usage
 * family taken out, a follow-up by `#<id>` among his open ones), so a name means one
 * thing whether she reads it or acts on it. A target that is not found, or fits several, is refused with the resolver's own
 * sentence, which says what to do next.
 *
 * Every target carries `spoken`, the name HE says it by: the card draws it and her read-back must say it. A card's is the
 * title when it is six words or fewer, else its name read as words; a run's is its slug read as words; a check's is its label (its
 * key when it has none); a follow-up's is the first words of its text (its number is nothing anyone says).
 *
 * `open` takes any of five kinds: it tries a card, then a run, then a page, then a chat, then a check, and a name that fits more than one
 * is refused with each named. To say which, the target is written with a kind in front (`chat: kaylee eyes`, `check: disk`). A check
 * is only ever opened, never acted on: no pending action holds one. The usage family (ruling 17) is not found by `open`. A check is named by
 * its exact path or exact name, or else by a phrase standing whole among the words of its name; a check that fits ONLY that last way gives
 * way to any other kind that fits, or fits several, so a name that opened one card still does, and a word that fits several cards is still
 * refused naming them.
 *
 * Consumers: `action-recipe.ts` (the eleven's prepare) and `direct-tools.ts` (`open`, `close_followup`).
 */

/** A resolution: the thing found, or the sentence that refuses and says what to do next. */
type Found<T> = { ok: true; value: T } | { ok: false; sentence: string };

const refused = (sentence: string): { ok: false; sentence: string } => ({ ok: false, sentence });

/** A card target with the cards around it: the roadmap's and the dispatcher's pictures were read once, for the resolution and for the checks that follow. */
export type CardFound = { target: Extract<CompanionActionTarget, { kind: 'card' }>; card: Card; book: CardBook };

/** A chain, found: its target and the chain's own status (`running` is not resumable). */
type ChainFound = { target: Extract<CompanionActionTarget, { kind: 'run' }>; status: string };

/** Words as a person says a house name: dashes and underscores are spaces. */
const asWords = (name: string): string => name.split(/[-_]+/).filter((part) => part !== '').join(' ');

/**
 * A card by what he named: its title or its name, through `resolveCard`. Both pictures are read; the dispatcher's is the one whose
 * rows (`plan`, `asking`, `hidden`) every card action checks, so a dispatcher that has not landed is told, not guessed past.
 * An epic's target name carries the dispatcher's own adornment (`<name>.arc`), which is how a door tells an epic from a plan of the same name.
 */
export async function findCard(house: CompanionHouse, ref: string): Promise<Found<CardFound>> {
  const [roadmap, dispatcher] = await Promise.all([house.roadmap(), house.dispatcher()]);
  if (dispatcher === null) return refused('The dispatcher has not been read yet; ask again in a moment.');
  const found = resolveCard(ref, roadmap, dispatcher);
  if (!found.ok) return refused(found.sentence);
  const { card } = found;
  return {
    ok: true,
    value: {
      target: { kind: 'card', name: card.kind === 'arc' ? `${card.name}.arc` : card.name, spoken: card.spoken, arc: card.kind === 'plan' ? card.arc : null },
      card,
      book: buildCardBook(roadmap, dispatcher),
    },
  };
}

/** The name he says a run by: its chain's slug as words (`kaylee--eyes--hands` is "kaylee eyes hands"), else its plan's name, else its id. */
function spokenRun(slug: string | null, plan: string | null, id: string): string {
  if (slug !== null && asWords(slug) !== '') return asWords(slug);
  return plan !== null && asWords(plan) !== '' ? asWords(plan) : id;
}

/** A run by what he named: the id `list_runs` printed, or `<plan> <task>`, through `resolveRun`. A soul alone is a run too (`soulOf`); only a chain resumes. */
export async function findRun(house: CompanionHouse, ref: string): Promise<Found<{ target: Extract<CompanionActionTarget, { kind: 'run' }>; kind: 'chain' | 'soul'; chatSessionId: string | null }>> {
  const resolved = await resolveRun(house, ref);
  if (!resolved.ok) return refused(resolved.sentence);
  const { run } = resolved;
  const slug = run.kind === 'chain' ? (readChainRun(run.id, { summaryOnly: true })?.slug ?? null) : null;
  const target = { kind: 'run' as const, runId: run.id, plan: run.plan, spoken: spokenRun(slug, run.plan, run.id) };
  return { ok: true, value: { target, kind: run.kind, chatSessionId: run.chatSessionId } };
}

/** A chain to resume: the run's target and the status its own record holds. A soul, a chain with no record and a record in the middle of running are refused, each with what to do. */
export async function findChain(house: CompanionHouse, ref: string): Promise<Found<ChainFound>> {
  const found = await findRun(house, ref);
  if (!found.ok) return found;
  const { target, kind } = found.value;
  if (kind === 'soul') {
    return refused(`${target.runId} is one soul's launch, not a chain; only a chain can be resumed with his rulings. list_runs shows the chain it belongs to.`);
  }
  const chain = readChainRun(target.runId, { summaryOnly: true });
  if (chain === null) return refused(`No record of the chain ${target.runId} could be read, so it cannot be resumed.`);
  return { ok: true, value: { target, status: chain.status } };
}

/**
 * The follow-up `#<id>` of his, open or closed, as its target. His number alone is the address (`list_followups` prints it): a word in the
 * text is nothing to match. One already closed resolves too, so the close answers "already closed" instead of sending her to look; an id that
 * is not his (another account's, or none) is refused.
 */
export function findFollowup(userId: number, ref: string): Found<Extract<CompanionActionTarget, { kind: 'followup' }>> {
  const id = /^(?:follow-?up\s*)?#?(\d{1,9})$/i.exec(ref.trim())?.[1];
  if (id === undefined) return refused('A follow-up is named by its number, #<id>, as list_followups prints it.');
  const item = findFollowupForAccount(userId, Number(id));
  if (item === null) return refused(`#${id} is not one of his follow-ups; list_followups shows the open ones.`);
  const spoken = item.followup.text.split(/\s+/).slice(0, 5).join(' ').replace(/[\s.,;:!?"“”]+$/u, '');
  return { ok: true, value: { kind: 'followup', id: item.followup.id, sessionId: item.sessionId, spoken, text: item.followup.text } };
}

// ---------------------------

//----------------- OPEN: WHICHEVER KIND FITS ------------

/** The kinds `open` tries, in its order. */
type OpenKind = 'card' | 'run' | 'page' | 'chat' | 'check';

/** The shape of each kind's refusal when nothing of that kind has the name (not the several-fit or the did-not-answer refusals, which are said). */
const NOTHING_OF_KIND: Readonly<Record<OpenKind, RegExp>> = {
  card: /^No card is named/,
  run: /^(?:No run is recorded as|"[^"]*" is not a run id|Name the run by)/,
  page: /^No DocSpace page has the id/,
  chat: /^No chat of his is named/,
  check: /^No check is named/,
};

/** How many of the checks a phrase fits a refusal names before it says how many it left out. */
const CHECKS_NAMED_MAX = 6;

/** One kind's candidate for the open: the wire target, where the open lands, and the name it is called by in a refusal. */
type OpenCandidate = { kind: OpenKind; target: CompanionActionTarget; open: CompanionOpenTarget; called: string };

/**
 * What one kind answered for the open: its candidate, nothing, or the sentence that refuses. `loose` marks a check answer that fits only
 * by words inside a name (not its exact path or name): it counts only when no other kind matched.
 */
type KindAnswer = ({ found: OpenCandidate } | { none: true } | { sentence: string }) & { loose?: true };

/** The beginning of every resolver's several-fit refusal (`"x" fits 2 cards: …`): the kind matched, more than once. */
const SEVERAL_FIT = /^".*" fits \d+ /;

/** The kind a target string names up front (`chat: kaylee eyes`), and the rest of it. */
function splitKind(ref: string): { kind: OpenKind | null; rest: string } {
  const named = /^(card|run|page|chat|check)\s*:\s*(.+)$/i.exec(ref.trim());
  return named === null ? { kind: null, rest: ref.trim() } : { kind: named[1].toLowerCase() as OpenKind, rest: named[2].trim() };
}

/** A page ref may end `#<block id>`: the block the open lands on, when the page holds one by that id. */
function splitBlock(ref: string): { page: string; block: string | null } {
  const at = ref.lastIndexOf('#');
  return at > 0 && at < ref.length - 1 ? { page: ref.slice(0, at).trim(), block: ref.slice(at + 1).trim() } : { page: ref, block: null };
}

/**
 * The check candidate for `ref`: found through `findChecksToOpen` over the overview with the usage family taken out, so a spend check is
 * not found by her `open` (ruling 17). One answers; several are refused naming each by name, path and word (the first few, then how many
 * more) and never by reading; none is the kind's nothing. A Cerberus that cannot be read is a refusal that says so, which another kind
 * that fits outranks, the same as DocSpace being down. An answer that fits only by words inside a name is marked `loose`.
 */
function checkCandidate(house: CompanionHouse, ref: string, nothing: (sentence: string) => { none: true } | { sentence: string }): KindAnswer {
  let found: ReturnType<typeof findChecksToOpen>;
  try {
    found = findChecksToOpen(withoutUsageChecks(house.cerberus()), ref);
  } catch (error) {
    console.error('[Companion] open could not read Cerberus', error);
    return { sentence: 'Cerberus could not be read just now, so no check was looked for.' };
  }
  const { checks, exact } = found;
  const loose = exact ? {} : { loose: true as const };
  if (checks.length === 0) return nothing(`No check is named "${ref}".`);
  if (checks.length > 1) {
    const left = checks.length - CHECKS_NAMED_MAX;
    const named = choiceLines(checks.slice(0, CHECKS_NAMED_MAX)).join('; ');
    return { sentence: `"${ref}" fits ${checks.length} checks: ${named}${left > 0 ? `; and ${left} more` : ''}. Say which by its path, <node>/<service>/<check>, for example "check: ${checks[0].check.node}/${checks[0].check.key}".`, ...loose };
  }
  const { check } = checks[0];
  const label = checkName(check);
  return {
    found: {
      kind: 'check',
      target: { kind: 'check', node: check.node, key: check.key, spoken: label },
      open: { kind: 'check', node: check.node, key: check.key },
      called: `the check ${label}`,
    },
    ...loose,
  };
}

/** The candidate of one kind for `ref`, or the sentence that kind refuses with (and whether it merely found nothing). */
async function candidateOf(house: CompanionHouse, kind: OpenKind, ref: string): Promise<KindAnswer> {
  const nothing = (sentence: string): { none: true } | { sentence: string } => (NOTHING_OF_KIND[kind].test(sentence) ? { none: true } : { sentence });
  if (kind === 'card') {
    const found = await findCard(house, ref);
    if (!found.ok) return nothing(found.sentence);
    const { target, card } = found.value;
    return { found: { kind, target, open: { kind: 'card', plan: card.name }, called: `the card ${target.spoken}` } };
  }
  if (kind === 'run') {
    const found = await findRun(house, ref);
    if (!found.ok) return nothing(found.sentence);
    const { target, chatSessionId } = found.value;
    // A dispatcher run opens its plan's card; a chat's run opens the chat that launched it.
    const open: CompanionOpenTarget | null = target.plan !== null ? { kind: 'card', plan: target.plan } : chatSessionId !== null ? { kind: 'chat', sessionId: chatSessionId } : null;
    if (open === null) return { sentence: `The run ${target.runId} has neither a plan card nor a chat of his to open.` };
    return { found: { kind, target, open, called: `the run ${target.spoken}` } };
  }
  if (kind === 'page') {
    const { page: pageRef, block } = splitBlock(ref);
    const found = await resolvePage(pageRef);
    if (!found.ok) return nothing(found.sentence);
    const page = found.value;
    const blockId = block !== null && page.blocks.some((candidate) => candidate.id === block) ? block : null;
    return { found: { kind, target: { kind: 'page', pageId: page.id, blockId, spoken: page.title }, open: { kind: 'page', pageId: page.id, blockId }, called: `the page ${page.title}` } };
  }
  if (kind === 'check') return checkCandidate(house, ref, nothing);
  const chat = resolveChat(ref);
  if (!chat.ok) return nothing(chat.sentence);
  return { found: { kind, target: { kind: 'chat', sessionId: chat.chat.sessionId, spoken: chat.chat.name }, open: { kind: 'chat', sessionId: chat.chat.sessionId }, called: `the chat ${chat.chat.name}` } };
}

/**
 * The one thing `open` opens: a card, then a run, then a page, then a chat, then a check, whichever fits. A name that fits more than one
 * kind is refused with each named and how to say which; one kind that fits several of its own (two cards) is that kind's own refusal; a
 * kind that did not answer (DocSpace down) is skipped when another kind fits. Nothing fitting is one sentence naming the five. A check
 * that fits only by words inside its name (`loose`) stands aside whenever another kind found something or fit several, and is heard
 * only when every other kind found nothing: a card named `Notes` is not made ambiguous by a check whose label holds the word.
 */
export async function findOpenTarget(house: CompanionHouse, ref: string): Promise<Found<{ target: CompanionActionTarget; open: CompanionOpenTarget }>> {
  const { kind: wanted, rest } = splitKind(ref);
  const kinds: OpenKind[] = wanted === null ? ['card', 'run', 'page', 'chat', 'check'] : [wanted];
  const heard = await Promise.all(kinds.map((kind) => candidateOf(house, kind, rest)));
  const otherMatched = heard.some((answer) => answer.loose !== true && ('found' in answer || ('sentence' in answer && SEVERAL_FIT.test(answer.sentence))));
  const answers = otherMatched ? heard.filter((answer) => answer.loose !== true) : heard;
  const fits = answers.flatMap((answer) => ('found' in answer ? [answer.found] : []));
  if (fits.length > 1) {
    return refused(`"${rest}" fits ${fits.length} kinds of thing: ${fits.map((fit) => fit.called).join('; ')}. Say which by writing the target with its kind in front, for example "${fits[0].kind}: ${rest}".`);
  }
  if (fits.length === 1) return { ok: true, value: { target: fits[0].target, open: fits[0].open } };
  const said = answers.flatMap((answer) => ('sentence' in answer ? [answer.sentence] : []));
  if (said.length > 0) return refused(said.join(' '));
  return refused(`Nothing of his is named "${rest}": not a card, a run, a page, a chat or a check. list_roadmap, list_runs, search_docs, list_sessions and read_cerberus find them.`);
}
