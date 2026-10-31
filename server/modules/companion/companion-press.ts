import { transcribeSpeech, type TranscribeAnswer } from '@/modules/voice/index.js';
import type { VoiceAudioUpload } from '@/shared/types.js';
import type { AppError } from '@/shared/utils.js';

import { stripCall } from '../../../shared/wake-words.js';

import type { CompanionAccount } from './companion-account.js';
import { MESSAGE_TEXT_MAX, characterCount, geminiRefusal, inputInvalid } from './companion-input.js';
import { readCompanionSettings } from './companion-settings.js';

/**
 * The press, from the clip to her turn. A press is OPENED two ways: by his talk button (`opened: 'button'`) or by her name
 * (`opened: 'name'`: the page's ears heard a sentence begin with it and uploaded the clip through this same door). Every
 * press is ONE turn and she always answers, if only with a word (ruling 6). The page's ears are the only listening there is,
 * and nothing leaves the page before her name, so the server keeps no silence timer and no gate.
 *
 * A press does three things, in this order:
 *   1. a button press takes the floor for the page that pressed, at once, so she acts on that page whatever the clip says. A
 *      name press does not take it from the page that holds it: the ears listen only on the page that holds the floor, so a
 *      name press from any other page is the clip a page still held when the floor moved away from it (its ears closed `gone`),
 *      and taking the floor back would undo the move that closed it. With no page holding the floor, a name press takes it;
 *   2. it is HEARD: a clip shorter than `EMPTY_PRESS_UNDER_MS` by the page's own clock (or one with no bytes) is the empty
 *      press with no Gemini call; any other goes through the voice barrel's `transcribeSpeech`, whose empty answer is the
 *      empty press too and whose text is what he said. A name press is heard exactly as a button press is: the same call,
 *      the same refusals, the same arrival order;
 *   3. it is SETTLED: his line joins her log (role `operator`, via `spoken`, the words as its text, `''` for the empty
 *      press) and is pushed to her, as `<operator via="spoken">…`, `<operator via="spoken" heard="nothing">` or, for a
 *      name press that was only her name, `<operator via="spoken" heard="name">`.
 *
 * WHAT A NAME PRESS LOGS AND PUSHES. "what he says after the wake word is the press" (ruling 2): `stripCall` cuts her name
 * (settings' `name`, default Kaylee) and its greetings off the front of Gemini's transcript, and a closing "over to you,
 * <name>" off the back, before anything is logged or pushed, so "Hey Kaylee, what chats are working?" reaches her as "What
 * chats are working?". When nothing is left he only called her: the log keeps the transcript as heard ("Kaylee."), which
 * is what her memory's exact-text match needs, and she is pushed `heard="name"`, a turn she answers as someone called by
 * name does. Gemini's words that do not open with her name are pushed as they are, their opening untouched: the page
 * already heard her name, a misheard "Gilly" must not swallow his call, and his answer asks Gemini for no second check.
 *
 * A button press is untouched by any of this: its transcript is logged and pushed as heard.
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

/** The clip a press carries, how long the page's recorder says it ran and what opened it: his talk `button`, or her `name` heard by the page's ears. Consumed by `companion.service.ts` and `companion.routes.ts`. */
export type PressInput = { audio: VoiceAudioUpload; durationMs: number; opened: 'button' | 'name' };

/** What a press answers: the words as they were logged (a name press less her name and the close), the transcript as heard when he only called her, `''` for the empty press. Consumed by `companion.service.ts` and `companion.routes.ts`. */
export type PressAnswer = { text: string };

/** What one settled press puts in her log (`logged`) and which push wakes her: his words, the empty press, or a call by name with nothing after it. */
type Settling = { logged: string; push: 'words' | 'empty' | 'called' };

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

/** The name her ears and her cuts listen for: the account's setting, Kaylee unless he renamed her. Read at each press, never cached. */
function nameOf(account: CompanionAccount): string {
  return readCompanionSettings(account.userId).name;
}

/**
 * What a heard press becomes. A button press, and a name press that heard nothing, are logged as heard. A name press is cut
 * by `stripCall` first: what is left of it is his line; when nothing is left he only called her (or only closed on her
 * name), so the log keeps the transcript as heard and she is pushed the call. `stripCall` leaves '' only when a cut took
 * the whole transcript, and Gemini's text is never blank, so an empty `rest` is always a call.
 */
function settling(account: CompanionAccount, transcript: string, opened: PressInput['opened']): Settling {
  if (transcript === '') return { logged: '', push: 'empty' };
  if (opened === 'button') return { logged: transcript, push: 'words' };
  const { rest } = stripCall(transcript, nameOf(account));
  return rest === '' ? { logged: transcript, push: 'called' } : { logged: rest, push: 'words' };
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

  /** Logs his line and pushes it: the words as spoken, the empty press, or his call by name. Runs in the chain, in arrival order. */
  function settle(account: CompanionAccount, answer: TranscribeAnswer, opened: PressInput['opened']): PressAnswer {
    if (!answer.ok) return refuseUnheard(account, geminiRefusal(answer));
    const { logged, push } = settling(account, answer.text, opened);
    // The limit reads what would be logged, so a name press is measured less its name.
    const characters = characterCount(logged);
    if (characters > MESSAGE_TEXT_MAX) return refuseUnheard(account, tooLongError(characters));
    // The transcription can take seconds: the server may have begun to stop meanwhile.
    refuseWhileStopping();
    account.store.appendLog({ role: 'operator', via: 'spoken', text: logged });
    if (push === 'empty') account.session.pushOperatorEmpty();
    else if (push === 'called') account.session.pushOperatorCalled();
    else account.session.pushOperator(logged, 'spoken');
    return { text: logged };
  }

  /** The press of the page `client`: answers what was heard once it has been settled, in its turn. */
  return async function press(userId: number, client: string, input: PressInput): Promise<PressAnswer> {
    refuseWhileStopping();
    const account = accountOf(userId);
    if (input.opened === 'button' || account.store.readState().floor === null) account.store.setFloor(client);

    // Started now, before the press ahead of this one is done: the uploads overlap, the pushes do not.
    const heard = hear(userId, input);
    const ahead = chains.get(userId) ?? Promise.resolve();
    const settled = ahead.then(async () => settle(account, await heard, input.opened));

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
