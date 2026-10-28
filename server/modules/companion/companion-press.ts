import { transcribeSpeech, type TranscribeAnswer } from '@/modules/voice/index.js';
import type { VoiceAudioUpload } from '@/shared/types.js';
import type { AppError } from '@/shared/utils.js';

import type { CompanionAccount } from './companion-account.js';
import { MESSAGE_TEXT_MAX, characterCount, geminiRefusal, inputInvalid } from './companion-input.js';

/**
 * The press of his talk button, from the clip to her turn. Every press is ONE turn and she always answers, if only with a
 * word (ruling 6): nothing listens between presses, so there is no silence timer, no wake word and no gate here.
 *
 * A press does three things, in this order:
 *   1. it takes the floor for the page that pressed, at once, so she acts on that page whatever the clip says;
 *   2. it is HEARD: a clip shorter than `EMPTY_PRESS_UNDER_MS` by the page's own clock (or one with no bytes) is the empty
 *      press with no Gemini call; any other goes through the voice barrel's `transcribeSpeech`, whose empty answer is the
 *      empty press too and whose text is what he said;
 *   3. it is SETTLED: his line joins her log (role `operator`, via `spoken`, the transcript as its text, `''` for the empty
 *      press) and is pushed to her, as `<operator via="spoken">…` or `<operator via="spoken" heard="nothing">`.
 *
 * PUSHES KEEP ARRIVAL ORDER. Hearing starts when a press arrives, so two uploads can be in flight at once, but each
 * account keeps ONE chain: a press is settled only after the press before it was (pushed, or refused). A slow transcription
 * therefore never lets a later press overtake it into her conversation.
 *
 * A hearing that is refused or fails does not wake her. Nothing is pushed; a system line "I could not hear that: <sentence>"
 * goes into her log, and the press answers an `AppError` carrying that sentence — 409 `COMPANION_SPEECH_REFUSED` for
 * `no_key` and `refused`, 502 `COMPANION_SPEECH_FAILED` for `failed`. A transcript past `MESSAGE_TEXT_MAX` characters, the
 * limit of a typed line, is refused the same way (400 `COMPANION_INPUT_INVALID` naming `audio`, as the typed door names
 * `text`) rather than logged and pushed whole. Her Gemini calls are not counted against any budget (the operator's ruling),
 * so nothing here asks one.
 *
 * Consumer: `companion.service.ts`, which builds one and exposes it as its `press` verb for `POST /press`.
 */

/** A clip shorter than this (by the page's own clock, in ms) has no words to hear: it is the empty press, and Gemini is not asked. */
const EMPTY_PRESS_UNDER_MS = 400;

/** The clip a press carries and how long the page's recorder says it ran. Consumed by `companion.service.ts` and `companion.routes.ts`. */
export type PressInput = { audio: VoiceAudioUpload; durationMs: number };

/** What a press answers: the words he said as heard, `''` for the empty press. Consumed by `companion.service.ts` and `companion.routes.ts`. */
export type PressAnswer = { text: string };

/** What the press needs of the service: an account's Kaylee, and the refusal a server that is stopping gives. */
type PressDeps = {
  accountOf(userId: number): CompanionAccount;
  /** Throws the service's 503 once `stopAll` has run: a process woken then would have nothing left to end it. */
  refuseWhileStopping(): void;
};

/** The clip heard: the empty press without a request when there is nothing to hear, else the voice barrel's answer. Never rejects. */
async function hear(userId: number, { audio, durationMs }: PressInput): Promise<TranscribeAnswer> {
  if (durationMs < EMPTY_PRESS_UNDER_MS || audio.bytes.length === 0) return { ok: true, text: '' };
  try {
    return await transcribeSpeech(userId, audio);
  } catch (error) {
    // `transcribeSpeech` answers its expected failures as values; a throw is a defect, and the press must still settle in its turn.
    console.error(`[Companion] account ${userId}: hearing a press threw`, error);
    return { ok: false, reason: 'failed', sentence: 'Hearing it failed unexpectedly; the server logged why.' };
  }
}

/** The 400 of a transcript longer than a typed line may be: his words past the limit are not cut, the press says so and he says it in pieces. */
function tooLongError(characters: number): AppError {
  return inputInvalid(`It came to ${characters} characters and one press takes at most ${MESSAGE_TEXT_MAX}; say it in shorter pieces.`, 'audio');
}

/** A hearing that came to nothing, as the system line on her panel and the refusal the press answers. Nothing is pushed. */
function refuseUnheard(account: CompanionAccount, error: AppError): never {
  account.store.appendLog({ role: 'system', text: `I could not hear that: ${error.message}` });
  throw error;
}

/** Consumed by `companion.service.ts`: one per service, holding every account's chain. */
export function createPress({ accountOf, refuseWhileStopping }: PressDeps) {
  // Each account's chain: a promise that settles (never rejects) when the latest press so far has been pushed or refused.
  const chains = new Map<number, Promise<void>>();

  /** Logs his line and pushes it, the words as spoken or the empty press. Runs in the chain, in arrival order. */
  function settle(account: CompanionAccount, answer: TranscribeAnswer): PressAnswer {
    if (!answer.ok) return refuseUnheard(account, geminiRefusal(answer));
    const characters = characterCount(answer.text);
    if (characters > MESSAGE_TEXT_MAX) return refuseUnheard(account, tooLongError(characters));
    // The transcription can take seconds: the server may have begun to stop meanwhile.
    refuseWhileStopping();
    account.store.appendLog({ role: 'operator', via: 'spoken', text: answer.text });
    if (answer.text === '') account.session.pushOperatorEmpty();
    else account.session.pushOperator(answer.text, 'spoken');
    return { text: answer.text };
  }

  /** The press of the page `client`: answers what was heard once it has been settled, in its turn. */
  return async function press(userId: number, client: string, input: PressInput): Promise<PressAnswer> {
    refuseWhileStopping();
    const account = accountOf(userId);
    account.store.setFloor(client);

    // Started now, before the press ahead of this one is done: the uploads overlap, the pushes do not.
    const heard = hear(userId, input);
    const ahead = chains.get(userId) ?? Promise.resolve();
    const settled = ahead.then(async () => settle(account, await heard));

    const tail = settled.then(
      () => undefined,
      () => undefined,
    );
    chains.set(userId, tail);
    // An account with no press in flight keeps no chain.
    void tail.then(() => {
      if (chains.get(userId) === tail) chains.delete(userId);
    });
    return settled;
  };
}
