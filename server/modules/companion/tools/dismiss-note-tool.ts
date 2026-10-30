import { tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { CompanionNote } from '@/shared/companion-types.js';
import { guardedToolResult, textResult, type ToolTextResult } from '@/shared/tool-text-result.js';

import { escapeText } from '../session/companion-envelopes.js';
import { toolLine } from '../session/companion-prompt.js';

import type { CompanionToolDeps } from './companion-tools.js';

/**
 * `dismiss_note`: takes one card off his panel, the one by its number or, with none given, the newest he has not pinned. It goes
 * through the store's `removeNote`, as the panel's ✕ does (`DELETE /notes/:id`), so only this account's cards can be named.
 *
 * HIS PIN WINS. A card he pinned is his to keep in view: she cannot take it down, by number or by default. A number that names a
 * pinned card is refused ("pinned by him; only he takes it down"); no number takes the newest card that is NOT pinned, and when every
 * card is pinned there is none to take and that is refused too. His own ✕ takes down any card, pinned or not
 * (`DELETE /notes/:id`).
 *
 * A number that is not up is refused naming the cards that are, each with its title and a pinned one marked "(pinned by him)", so she
 * can correct herself and does not choose a card she cannot take down. A card he
 * dismissed in the same instant is not a refusal: the store answers `false` and the card is gone either way.
 *
 * Consumer: `tools/draft-tools.ts`, which puts the definition second in its list (`show_note`, `dismiss_note`, `update_draft`, …).
 */

/** A card's stored title on one line, escaped as an envelope escapes stored text (`escapeText`): it is echoed to her. */
const cardTitle = (card: CompanionNote): string => escapeText(card.title.replace(/\s+/g, ' ').trim());

/** A card as her answers name it: its number and its title on one line (`2 "Lane diff"`), so she can say which card went and choose between old ones. */
const cardLabel = (card: CompanionNote): string => `${card.id} "${cardTitle(card)}"`;

/** A card in the "up now" list of a refusal: its label, with "(pinned by him)" after a pinned one, so she does not choose a card she cannot take down. */
const upLabel = (card: CompanionNote): string => (card.pinned ? `${cardLabel(card)} (pinned by him)` : cardLabel(card));

/** The refusal for a pinned card: its number and title (typographic quotes, as the sentence is worded), and whose it is to take down. */
const pinnedSentence = (card: CompanionNote): string => `Card ${card.id} “${cardTitle(card)}” is pinned by him; only he takes it down.`;

/** What a refusal says when every card up is pinned and she gave no number: nothing is hers to take. */
const ALL_PINNED = 'Every card on his panel is pinned by him; only he takes those down.';

/** Takes `card` down through the store: the answer names it, and says when he had already taken it down himself. */
const takeDown = (deps: CompanionToolDeps, card: CompanionNote): ToolTextResult =>
  textResult(`Card ${cardLabel(card)} ${deps.store.removeNote(card.id) ? 'taken down' : 'was already gone'}.`);

/** `dismiss_note`: see the file's head. */
function dismissNote(deps: CompanionToolDeps, args: { note?: number }): Promise<ToolTextResult> {
  return guardedToolResult('dismiss_note', 'take the card down', () => {
    const cards = [...deps.store.listNotes()].sort((a, b) => a.id - b.id);
    if (cards.length === 0) return deps.refuse('There is no card on his panel.');

    if (args.note === undefined) {
      const newestUnpinned = cards.filter((card) => !card.pinned).at(-1);
      return newestUnpinned === undefined ? deps.refuse(ALL_PINNED) : takeDown(deps, newestUnpinned);
    }
    const named = cards.find((candidate) => candidate.id === args.note);
    if (named === undefined) return deps.refuse(`No card ${args.note} is on his panel; up now: ${cards.map(upLabel).join(', ')}.`);
    return named.pinned ? deps.refuse(pinnedSentence(named)) : takeDown(deps, named);
  });
}

/** The definition of `dismiss_note`, built with the SDK's `tool()` and zod. Not read-only (it writes what he sees). Consumed by `draft-tools.ts` (`draftTools`). */
export function dismissNoteTool(deps: CompanionToolDeps): SdkMcpToolDefinition<any> {
  return tool(
    'dismiss_note',
    toolLine('dismiss_note'),
    {
      note: z.number().int().min(1).optional().describe('The card\'s number, as show_note answered it. Leave out to take down the newest card he has not pinned. A card he pinned is refused.'),
    },
    (args) => dismissNote(deps, args)
  );
}
