import { MemoryRefusal, type Step } from './memory-plan.js';

/**
 * The memory-intake COMPOSER — the new whole-file content for one planned step, from the bytes the
 * file holds now. Pure: no disk, no clock, and `MemoryRefusal` is the only thing it throws.
 *
 * Split out of `memory-assert.ts` because it is the one piece that changes whenever a shelf learns a
 * new way to be filled (a blank-shelf restore, a heading rule); the plan and the write stay put.
 */

/**
 * The new whole-file content for one step, from the bytes the file holds now. Pure — no disk, and
 * MemoryRefusal is the only thing it throws.
 *
 * Consumer: `assertIntoTarget` in `memory-assert.ts`, which feeds it the file's current bytes and
 * guards the result before anything is written.
 */
export function compose(step: Step, current: string): string {
  const payload = step.payload.replace(/^\n+|\n+$/g, '');

  if (step.kind === 'create') {
    // Reached only when the path did NOT exist (the caller refuses otherwise), so there is nothing to
    // merge with: the note IS the body.
    return `${payload}\n`;
  }

  if (step.kind === 'line') {
    // A router line joins the file's last line DIRECTLY, with no blank-line gap, so it lands INSIDE a
    // trailing bullet list rather than orphaned below it.
    if (current.trim() === '') return `${payload}\n`;
    return `${current.replace(/\n+$/, '')}\n${payload}\n`;
  }

  if (step.kind === 'append') {
    if (current.trim() === '') return `${payload}\n`;
    return `${current.replace(/\n+$/, '')}\n\n${payload}\n`;
  }

  // 'section' on a BLANK shelf: there is no heading to land under and no session can write one (the
  // shelf guard refuses every added line), so the queue is the only door that can refill a wiped
  // file. A body that already carries the heading IS the file — a restore, title and note included;
  // any other body becomes the first entry under a title and heading minted here — the title is what
  // the session-start shape check (`hooks/shelf_health.py`) demands first, so a shelf this door
  // writes is never reported damaged. A file with content but no heading still refuses below: that is
  // somebody's document, and this lane does not reshape it.
  const carriesHeading = payload.split('\n').some((line) => line.trim() === step.anchor);
  if (current.trim() === '') {
    const minted = step.title ? `${step.title}\n\n${step.anchor}` : `${step.anchor}`;
    return carriesHeading ? `${payload}\n` : `${minted}\n\n${payload}\n`;
  }

  // 'section': land the payload at the END of the named heading's section — after whatever is already
  // there, before the NEXT '## ' heading, or at the end of the file when it is the last section.
  const lines = current.split('\n');
  const start = lines.findIndex((line) => line.trim() === step.anchor);
  if (start === -1) {
    throw new MemoryRefusal(
      `Refused — ${step.display} has no “${step.anchor}” section to add this under, and this lane `
        + `will not invent one. Add that heading yourself, then approve again. Nothing was changed.`
    );
  }
  // A body carrying its own heading is a whole-file restore, and only a blank shelf takes one. Here
  // the shelf holds content, so the pasted title, note and second heading would land INSIDE the
  // section and every later entry would land above them.
  if (carriesHeading) {
    throw new MemoryRefusal(
      `Refused — ${step.display} already has content, and this card carries its own “${step.anchor}” `
        + `heading, which only an empty shelf takes (it is written as the whole file). To add entries `
        + `to this shelf, queue them without the heading line. Nothing was changed.`
    );
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i;
      break;
    }
  }
  const head = lines.slice(0, end).join('\n').replace(/\n+$/, '');
  const tail = lines.slice(end).join('\n');
  const inserted = `${head}\n\n${payload}\n`;
  return tail.trim() === '' ? inserted : `${inserted}\n${tail}`;
}
