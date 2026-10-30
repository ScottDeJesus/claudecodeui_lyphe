import { runSummarizeVerb } from './compaction-children.js';
import { readVerbSuccess, verbFailureSentence } from './compaction-facts.js';

/**
 * The house summarizer for a caller that is not a chat compaction: one transcript in, one short text out,
 * through the same verb (`runSummarizeVerb`, so there is one way to spawn it) and the same reading of its
 * answer (`compaction-facts.ts`). Nothing of a chat is touched: no frame, no row, no seed, no session swap.
 *
 * WHAT THE VERB GIVES SUCH A CALLER. Its `summary` field is the text; its `seed` is the compaction's
 * (the earlier-conversation preamble, the transcript's path, every message the operator typed, the kept
 * tail, a line telling the new session to answer as if nothing were cut) and is no use to anyone but a chat.
 * Two things about the verb are bent for a caller that wants the WHOLE thread summarized:
 *   - it refuses a thread that fits in its verbatim tail (20,000 tokens: "nothing to compact yet", exit 2),
 *     which is every short thread; `SUMMARIZE_TAIL_TOKENS=0` (its documented seam, read at the call) shrinks
 *     the tail to the newest exchange, so everything before it is summarized;
 *   - that newest exchange (the operator's last prompt and the assistant's last text) is therefore NOT in
 *     the summary. A caller that needs it says it in `instructions`.
 * A thread with a single exchange has nothing before its tail and is still refused (exit 2, "nothing to compact
 * yet"): the failure then says `nothingBefore`, because for such a caller that is no failure but a thread that
 * IS its newest exchange, which it already holds.
 *
 * Consumers: the companion's fresh-start handover (`companion/session/companion-handover.ts`), through the barrel.
 */

/** What `summarizeTranscript` answers: the summary with the verb's model and tokens, or one sentence saying why there is none (`nothingBefore`: the thread has nothing before its newest exchange). */
type TranscriptSummary =
  | { ok: true; summary: string; model: string; tokensIn: number; tokensOut: number }
  | { ok: false; sentence: string; nothingBefore: boolean };

/**
 * Runs the verb on `transcriptPath` (the CLI session `providerSessionId`'s JSONL) with the caller's own `instructions` on stdin and waits at
 * most `waitMs` for it: past that, or when `signal` aborts, the verb is stopped and the answer is a failure sentence. Never rejects. A
 * verb that is not ready (exit 3), refuses the input (exit 2), fails (exit 1) or answers something unreadable is a failure sentence too.
 * Consumed by `companion/session/companion-handover.ts`.
 */
export async function summarizeTranscript(input: {
  transcriptPath: string;
  providerSessionId: string;
  instructions: string;
  waitMs: number;
  signal: AbortSignal;
}): Promise<TranscriptSummary> {
  const verb: { stop: (() => void) | null } = { stop: null };
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const given = runSummarizeVerb({
    transcriptPath: input.transcriptPath,
    providerSessionId: input.providerSessionId,
    instructions: input.instructions,
    env: { SUMMARIZE_TAIL_TOKENS: '0' },
    onChild: (stop) => {
      verb.stop = stop;
      if (input.signal.aborted) stop();
    },
  });
  // The two ways the wait ends early; each stops the verb it leaves behind (its child gets the SIGTERM, then the grace, then the kill).
  const cut = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`the summarizer did not answer within ${Math.round(input.waitMs / 1000)} s`), input.waitMs);
    timer.unref();
    onAbort = () => resolve('the summarizer was stopped');
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const answer = await Promise.race([given, cut]);
    if (typeof answer === 'string') {
      verb.stop?.();
      return { ok: false, sentence: answer, nothingBefore: false };
    }
    if (answer.exitCode !== 0) {
      const sentence = verbFailureSentence(answer);
      // The verb's own refusal of a thread with nothing before its newest exchange (MAN-8049, exit 2).
      return { ok: false, sentence, nothingBefore: answer.exitCode === 2 && /^nothing to compact yet/i.test(sentence) };
    }
    const success = readVerbSuccess(answer.json);
    const summary = typeof answer.json?.summary === 'string' ? answer.json.summary.trim() : '';
    if (success === null || summary === '') return { ok: false, sentence: 'the summarizer returned an answer that could not be read', nothingBefore: false };
    return { ok: true, summary, model: success.model, tokensIn: success.tokensIn, tokensOut: success.tokensOut };
  } finally {
    clearTimeout(timer);
    if (onAbort) input.signal.removeEventListener('abort', onAbort);
  }
}
