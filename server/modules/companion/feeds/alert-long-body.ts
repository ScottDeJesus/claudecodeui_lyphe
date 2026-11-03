import { writeFileSync } from 'node:fs';

import { characterCount } from '../companion-input.js';
import { companionScratchDir, nextScratchFile, pruneScratch } from '../tools/transcript-render.js';

/**
 * What an alert does with a body it asked the notification copy for WHOLE, when that body is free text of any length: a plan
 * awaiting approval or a tool permission's input (`wholeBodyKind` of `excerpt`). A question card (`wholeBodyKind` of `question`)
 * never comes here: it is handed over whole at any size, as it has been since 2026-10-28 — a design's questions and an Accept
 * census are house-shaped text, but a chat's own `AskUserQuestion` carries model-written text that no ceiling holds. Split from
 * `alert-block.ts` by cohesion — that file decides what an alert says, this one keeps a long body from becoming a cut she cannot
 * see past.
 *
 * The body goes into her envelope as it is up to `ALERT_BODY_MAX_CHARACTERS`. Past that the envelope carries the opening, then
 * the house's own cut marker (`… (N more characters not shown)`, the words `describeToolInput` uses) and where the whole text
 * is: rendered to her scratch folder, the place her other long reads are, so a sharper question can go to `ask_dactyl`. The
 * ceiling is what keeps a burst of twenty plans or tool inputs, her window's most, from handing her a message of megabytes (a plan
 * or a tool's input has no length of its own to lean on).
 *
 * A scratch folder that cannot be written costs the file and never the alert: the envelope still carries the opening and the
 * marker, and says that the rest could not be kept, so the cut is never silent.
 *
 * Consumer: `feeds/alert-block.ts`.
 */

/**
 * The most characters of a plan or a tool's input one alert carries, counted as a person counts them. A plan of a few screens is
 * handed over whole; twenty plans or tool inputs at this size (a window's most) are about 100 KB, the bound `alert-feed.ts` already
 * holds a message to. A question card is outside this ceiling and outside that estimate.
 */
const ALERT_BODY_MAX_CHARACTERS = 5_000;

/**
 * `body` for her envelope: whole when it is at most `ALERT_BODY_MAX_CHARACTERS`, else its opening, the count of what is left out
 * and the file holding the whole. `title` heads that file, `label` names it (`0007-<label>.md`).
 * Consumed by `buildAlertBlock`, once per alert whose body was asked for whole as an `excerpt`.
 */
export function boundedWholeBody(userId: number, body: string, title: string, label: string): string {
  const characters = characterCount(body);
  if (characters <= ALERT_BODY_MAX_CHARACTERS) return body;

  const opening = Array.from(body).slice(0, ALERT_BODY_MAX_CHARACTERS).join('');
  const marker = `… (${characters - ALERT_BODY_MAX_CHARACTERS} more characters not shown)`;
  return `${opening}${marker} ${whereTheWholeIs(userId, body, title, label)}`;
}

/** The sentence after the marker: the file the whole text was rendered to, or that it could not be kept. */
function whereTheWholeIs(userId: number, body: string, title: string, label: string): string {
  let scratch: string;
  let file: string;
  try {
    scratch = companionScratchDir(userId);
    // Named and written in the same tick: `nextScratchFile` takes the next number from what is on disk.
    file = nextScratchFile(scratch, label);
    writeFileSync(file, `# ${title}\n\n${body}\n`, 'utf8');
  } catch (error) {
    console.error(`[Companion] account ${userId}: the whole body of an alert (${label}) could not be kept in her scratch folder`, error);
    return 'The rest could not be kept here; the chat itself holds it.';
  }
  try {
    pruneScratch(scratch);
  } catch (error) {
    console.error(`[Companion] account ${userId}: her scratch folder could not be pruned`, error);
  }
  return `The whole text is rendered at ${file}; ask_dactyl can read that file.`;
}
