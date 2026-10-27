import { synthesizeSentence, type SpeechAnswer } from '@/modules/voice/index.js';
import { AppError } from '@/shared/utils.js';

import type { CompanionAccount } from './companion-account.js';
import { geminiRefusal } from './companion-input.js';
import { readCompanionSettings } from './companion-settings.js';
import { appendAudio, createSpeechEntry, finishEntry, followEntry, joinEntry, type SpeechEntry } from './companion-speech-cache.js';
import { utteranceOf, type Utterance } from './companion-utterance.js';

/**
 * Her voice for a page: the speech door's verbs, `speak` (`GET /speech/:turnId/:index`) and `cut` (`POST /cut`).
 *
 * A PAGE PULLS A SENTENCE and the server speaks it for that page alone. The request must come from the page that holds the
 * floor (409 `COMPANION_NOT_FLOOR` for any other, so two open pages cannot both spend) and name a sentence of her CURRENT
 * turn (404 `COMPANION_NO_SENTENCE` for an unknown turn or index, a turn that is over or a log that was cleared). The sentence
 * is rebuilt from its log row (`companion-utterance.ts`): a sentence with nothing to say is not synthesized (204). The audio
 * is then Gemini's streamed synthesis (`synthesizeSentence`), piped on as it arrives and kept in the account's cache
 * (`companion-speech-cache.ts`) for the rest of the turn, so a second request for the sentence costs no second call.
 *
 * A CALL GOOGLE REFUSES (no key, a refused key) is 409 `COMPANION_SPEECH_REFUSED` with Google's sentence as the message, and
 * the turn's panel gains ONE system line, "I could not speak: <sentence>", however many sentences are refused after it. Any
 * other failure before the first byte is 502 `COMPANION_SPEECH_FAILED`. Her speech is not counted against any Gemini budget
 * (the operator's ruling, 2026-10-26): nothing here asks one.
 *
 * THE CUT is the press of the talk button while she speaks. It stops every synthesis of the turn still in flight, stops her
 * running turn, and owes the cut: her next message opens with `<cut heard="…" interrupted="…"/>`, the display text of the
 * last sentence that played to its end and of the one playing at the press (`''` for a sentence the page names `null`).
 *
 * One log line per speech request: `[companion] speech <turn>/<index> client=<id> → <status> (<cache|gemini>)`, where the
 * parenthesis says whether the request found the sentence in the cache (or followed the call already running for it) or
 * started a call, and is left out when the request was refused before either.
 *
 * Consumer: `companion.service.ts`, which builds one and exposes `speak` as `speech` and `cut` for the routes.
 */

/** Which sentence a page pulls. */
type SpeechRequest = { turnId: string; index: number };

/** What `speak` answers: nothing to say (204), or the audio, which is complete when the iterable ends with its request still open. */
type SpeechReply = { kind: 'nothing' } | { kind: 'audio'; chunks: AsyncIterable<Buffer> };

/** The page's cut: the turn, the last sentence whose playback ended and the one playing at the press (`null` for none). */
type CutRequest = { turnId: string; heard: number | null; interrupted: number | null };

/** What the speech door needs of the service: an account's Kaylee. */
type SpeechDeps = { accountOf(userId: number): CompanionAccount };

const noSentence = (): AppError =>
  new AppError('She has no such sentence to say: it is not in her current turn.', { code: 'COMPANION_NO_SENTENCE', statusCode: 404 });

const notFloor = (): AppError =>
  new AppError('Another page holds the floor, so her voice plays there; this page shows her words only.', { code: 'COMPANION_NOT_FLOOR', statusCode: 409 });

/**
 * Starts the synthesis of one sentence and puts its entry in the account's cache. The entry's `opened` settles with the
 * first audio (`null`) or with the refusal the door answers; the rest of the audio is read in the background into the entry.
 */
function startSynthesis(account: CompanionAccount, { turnId, index }: SpeechRequest, utterance: Utterance): SpeechEntry {
  const { userId, store, speechCache } = account;
  const label = `${turnId}/${index}`;

  /** The audio of an opened call, read into the entry until it ends. A sentence that stopped before its end is not kept. */
  async function fill(entry: SpeechEntry, chunks: AsyncIterable<Uint8Array>): Promise<void> {
    let stoppedEarly = false;
    try {
      for await (const chunk of chunks) {
        // Leaving the loop closes the stream underneath: after a cut or a hang-up not one more piece is read.
        if (entry.abort.signal.aborted) break;
        // Copied: the voice module's pieces are views into buffers it still reads from.
        appendAudio(entry, Buffer.from(chunk));
        speechCache.trim();
      }
    } catch (error) {
      stoppedEarly = true;
      console.error(`[companion] speech ${label}: the audio stopped early: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A cut or a hang-up ends the stream quietly, so the abort is read as well as the throw: half a sentence is never replayed.
    if (stoppedEarly || entry.abort.signal.aborted) speechCache.remove(turnId, index, entry);
    finishEntry(entry);
  }

  /** The turn's one "I could not speak" line; a panel that cannot be written to must not turn a refusal into a defect. */
  function writeRefusalLine(sentence: string): void {
    if (!speechCache.claimRefusalLine(turnId)) return;
    try {
      store.appendLog({ role: 'system', text: `I could not speak: ${sentence}` });
    } catch (error) {
      console.error(`[companion] account ${userId}: the refusal of ${label} could not be written to her panel`, error);
    }
  }

  async function open(entry: SpeechEntry): Promise<AppError | null> {
    let answer: SpeechAnswer;
    try {
      answer = await synthesizeSentence(userId, { text: utterance.text, style: utterance.style, signal: entry.abort.signal });
    } catch (error) {
      // `synthesizeSentence` answers its expected failures as values; a throw is a defect, and the request must still be answered.
      console.error(`[companion] speech ${label}: the synthesis threw`, error);
      answer = { ok: false, reason: 'failed', sentence: 'Gemini could not speak this: it failed unexpectedly; the server logged why.' };
    }
    if (!answer.ok) {
      speechCache.remove(turnId, index, entry);
      finishEntry(entry);
      if (answer.reason !== 'failed') writeRefusalLine(answer.sentence);
      return geminiRefusal(answer);
    }
    void fill(entry, answer.chunks);
    return null;
  }

  const entry = createSpeechEntry(open);
  speechCache.put(turnId, index, entry);
  return entry;
}

/** The sentence for `request`, as the audio of its entry; the checks that decide a refusal come first, in the order the file header lists them. */
async function serve(account: CompanionAccount, client: string, request: SpeechRequest, signal: AbortSignal, noteSource: (source: 'cache' | 'gemini') => void): Promise<SpeechReply> {
  const { userId, store, speechCache } = account;
  if (store.readState().floor !== client) throw notFloor();
  if (!speechCache.isCurrent(request.turnId)) throw noSentence();

  let entry = speechCache.find(request.turnId, request.index);
  if (entry === undefined) {
    const row = store.readSentence(request.turnId, request.index);
    if (row === null) throw noSentence();
    const utterance = utteranceOf(row, readCompanionSettings(userId).deliveryNote);
    if (utterance === null) return { kind: 'nothing' };
    entry = startSynthesis(account, request, utterance);
    noteSource('gemini');
  } else {
    noteSource('cache');
  }

  const leave = joinEntry(entry, signal);
  const refusal = await entry.opened;
  if (refusal !== null) {
    leave();
    throw refusal;
  }
  return { kind: 'audio', chunks: followEntry(entry, signal, leave) };
}

/** Consumed by `companion.service.ts`: one per service. */
export function createSpeech({ accountOf }: SpeechDeps) {
  /**
   * The audio of one sentence for the page `client`, which must hold the floor. `signal` is the request's: it aborts when the
   * page goes away, and the synthesis stops with its last request. Throws the `AppError` of a refusal before the first byte.
   */
  async function speak(userId: number, client: string, request: SpeechRequest, signal: AbortSignal): Promise<SpeechReply> {
    const label = `${request.turnId}/${request.index} client=${client}`;
    let source: 'cache' | 'gemini' | null = null;
    const logLine = (status: number): void => console.log(`[companion] speech ${label} → ${status}${source === null ? '' : ` (${source})`}`);
    try {
      const reply = await serve(accountOf(userId), client, request, signal, (found) => {
        source = found;
      });
      logLine(reply.kind === 'nothing' ? 204 : 200);
      return reply;
    } catch (error) {
      logLine(error instanceof AppError ? error.statusCode : 500);
      throw error;
    }
  }

  /**
   * He pressed talk while she spoke. In this order: every synthesis of the turn still in flight is stopped (nothing more is
   * spent), the cut is owed to her next message, and her running turn is interrupted, which can take a moment. The cut is owed
   * BEFORE the interrupt is awaited, so the press's own message, which can arrive while she is stopping, already carries it.
   * A turn the log no longer holds still stops her and owes a cut with both sentences empty.
   */
  async function cut(userId: number, { turnId, heard, interrupted }: CutRequest): Promise<void> {
    const { store, session, speechCache } = accountOf(userId);
    const stopped = speechCache.abortTurn(turnId);
    const textOf = (index: number | null): string | null => (index === null ? null : (store.readSentence(turnId, index)?.text ?? null));
    session.oweCut(textOf(heard), textOf(interrupted));
    console.log(`[companion] cut ${turnId} heard=${heard ?? 'none'} interrupted=${interrupted ?? 'none'}: ${stopped} synthesis(es) stopped`);
    await session.interrupt();
  }

  return { speak, cut };
}
