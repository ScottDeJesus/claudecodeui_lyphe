import { runDispatcherCommand, type DispatcherCommandDependencies } from '@/shared/dispatcher-command.js';

/**
 * A card's design as the dispatcher prints it: `dispatcher show <name>`, the one reader of a plan's or
 * an epic's text there is (the design, its goal, its tasks, what it waits on). The Roadmap tab has no
 * panel reader for it, and `dispatcher status --json` does not carry it, so Kaylee's `read_card` asks the
 * lane for it by name, through the lane's own command and child environment (no `CLAUDE_CODE_SESSION_ID`,
 * no `DISPATCHER_SESSION`), exactly as a relayed verb runs.
 *
 * Nothing here writes the store: `show` is a read.
 */

/** A plan's or an arc's name, with or without `.arc` — the shape `dispatcher.routes.ts` fences every name with. */
const CARD_NAME = /^[a-z0-9][a-z0-9-]{0,99}(\.arc)?$/;

/** How much of the dispatcher's own line a refusal carries: one line names the cause, and the rest is a traceback's body. */
const FAILURE_LINE_CHARS = 200;

/**
 * What the dispatcher answered for a card's text: the text whole on exit 0, else the dispatcher's own
 * first line (a name it does not hold answers its own `no plan <name>`). Consumed by the dispatcher
 * module's `cardText` handle and, through the dispatcher barrel, by the companion house (`HouseText`).
 */
export type DispatcherCardText = { ok: true; text: string } | { ok: false; sentence: string };

/** The non-blank lines of one stream, trimmed. */
function linesOf(stream: string): string[] {
  return stream.split('\n').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * Runs `show <name>`. Never throws: a refusal, a timeout, an overflow and a missing binary are each a sentence.
 * A name that is no plan or arc name never reaches the dispatcher (a leading dash would be read as one of
 * its flags) and is answered in the dispatcher's own not-found wording.
 *
 * WHICH SENTENCE. The dispatcher refuses on STDOUT (`no plan <name>`, exit 1), so its first stdout line is the
 * answer; a traceback is on stderr and its LAST line names the exception. When the dispatcher never got to
 * answer (`answer.reason`: stopped by the ceiling, or never started, or printed past the buffer) the stdout is a
 * PARTIAL document or nothing, and its first line posed as a sentence would read like the dispatcher's own, so the
 * sentence is ours and says what happened. A command that exits 0 and prints nothing is no text.
 *
 * Consumed by `dispatcher.module.ts`, which hands the result to the companion as `cardText`.
 */
export async function readCardText(name: string, commands: DispatcherCommandDependencies): Promise<DispatcherCardText> {
  if (!CARD_NAME.test(name)) return { ok: false, sentence: `no plan ${name.slice(0, 100)}` };
  const answer = await runDispatcherCommand(['show', name], commands);
  if (answer.reason === 'timeout') return { ok: false, sentence: `dispatcher show ${name} was stopped before it finished; read the card again in a moment` };
  if (answer.reason === 'spawn-failed') return { ok: false, sentence: `dispatcher show ${name} did not give its text back: the command could not be started, or its text is past what a read allows` };
  if (answer.ok) {
    return answer.stdout.trim().length > 0 ? { ok: true, text: answer.stdout } : { ok: false, sentence: `dispatcher show ${name} printed nothing` };
  }
  const sentence = linesOf(answer.stdout)[0] ?? linesOf(answer.stderr).at(-1) ?? `dispatcher show ${name} exited ${answer.exit ?? 'without an answer'}`;
  return { ok: false, sentence: sentence.slice(0, FAILURE_LINE_CHARS) };
}
