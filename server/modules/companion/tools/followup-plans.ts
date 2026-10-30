import { buildCardBook, planStepWords } from '../eyes/card-lines.js';
import type { CompanionHouse } from '../house.js';

/**
 * The step of each plan a follow-up names, so a stale follow-up reads stale at a glance. A follow-up filed as "waits on Queue" stays
 * open after the plan it names has shipped; beside it, `list_followups` now says `[drying-report-direct-readers: shipped Oct 27]`.
 *
 * A name counts when it stands in the follow-up's text as a WHOLE word: neither side of it is a letter, a digit, an underscore or a
 * dash, so `kaylee` is not found inside `kaylee--eyes`, nor `kaylee--eyes` inside `kaylee--eyes-two`. Each name is bracketed once, in
 * the order the names first stand in the text. The names are the dispatcher picture's plans and the roadmap's features (a plan the
 * dispatcher dropped a day after it finished is still a roadmap row, and that is the plan a stale follow-up names); the step is the
 * Roadmap tab's words for a feature (`card-lines.ts`) and the In flight face's badge for a plan the roadmap does not hold. A lane that
 * has not landed, or whose read fails, adds no bracket: the lines are then exactly what they were without it.
 *
 * Consumer: `read-tools.ts` (`list_followups`).
 */

/** Whether `name` stands in `text` as a whole word, and where it first does (-1 when it does not). */
function wholeWordAt(text: string, name: string): number {
  const inName = /[A-Za-z0-9_-]/;
  for (let from = text.indexOf(name); from !== -1; from = text.indexOf(name, from + 1)) {
    const before = from === 0 ? '' : text[from - 1];
    const after = text[from + name.length] ?? '';
    if (!inName.test(before) && !inName.test(after)) return from;
  }
  return -1;
}

/** A lane's picture, or null when it has not landed or its read failed (said once in the journal, so the follow-ups are still answered). */
async function pictureOrNull<T>(lane: string, read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.error(`[Companion] list_followups could not read the ${lane} picture for the plan steps`, error);
    return null;
  }
}

/**
 * For each follow-up text, the brackets to put after it: `' [<plan>: <step words>]'` for every plan it names, or `''`. The answer is
 * the same length and order as `texts`. Consumed by `list_followups`.
 */
export async function stepBrackets(house: CompanionHouse, texts: readonly string[]): Promise<string[]> {
  const [roadmap, dispatcher] = await Promise.all([pictureOrNull('roadmap', () => house.roadmap()), pictureOrNull('dispatcher', () => house.dispatcher())]);
  if (roadmap === null && dispatcher === null) return texts.map(() => '');
  const book = buildCardBook(roadmap, dispatcher);
  const names = book.cards.filter((card) => card.kind === 'plan').map((card) => card.name);
  return texts.map((text) => {
    const named = names.flatMap((name) => {
      const at = wholeWordAt(text, name);
      return at === -1 ? [] : [{ name, at }];
    });
    return named
      .sort((a, b) => a.at - b.at)
      .flatMap(({ name }) => {
        const step = planStepWords(name, book);
        return step === null ? [] : [` [${name}: ${step}]`];
      })
      .join('');
  });
}
