import type { CompanionSettings } from '@/shared/companion-types.js';
import type { GeminiKeyStatus, HomeServerKeyStatus, VoiceSettings } from '@/shared/types.js';

import { characterCount } from '../companion-input.js';
import { COMPANION_EFFORT } from '../session/companion-launch.js';

/**
 * Her settings and the voice's, for `read_settings` (`house-reads.ts`), as one line per setting. PURE — the settings arrive as
 * values (her effort is the launch's own constant, no setting of his). Nothing here is written back: `read_settings` reads, and
 * no tool of hers writes his settings.
 *
 * NEVER A KEY. The Gemini key is said by whose it is, and the home server's by whether it is set, and by nothing of either:
 * `last4` of neither status is read in this file, so not even the last characters of a key of his can reach her context.
 *
 * Consumer: `house-reads.ts` (`read_settings`).
 */

/** The Gemini key in use, by the status's `source`: his own, the house's, or none. The one sentence a key is ever said in. */
const KEY_WORDS: Readonly<Record<GeminiKeyStatus['source'], string>> = {
  stored: 'a key of yours',
  house: "the house's key",
  none: 'no key',
};

/** The chat's read-aloud provider by its name. */
const PROVIDER_WORDS: Readonly<Record<VoiceSettings['provider'], string>> = { openai: 'OpenAI', gemini: 'Gemini' };

/**
 * `companion`: her name and his, her model by the label the picker shows, her effort (fixed at her launch, so no field of
 * `settings`), Live on or off, her delivery note, her talk button's label, and her register's length with whether it is the
 * original. `originalRegister` is the product's template (`COMPANION_REGISTER_DEFAULT`); a register equal to it, ends trimmed,
 * is the original, because the settings store trims a text.
 */
export function companionSettingsLines(settings: CompanionSettings, modelLabel: string, originalRegister: string): string[] {
  const original = settings.register.trim() === originalRegister.trim();
  return [
    `Her name: ${settings.name}. His name, as she says it: ${settings.operatorName}.`,
    `Her model: ${modelLabel}.`,
    `Her effort: ${COMPANION_EFFORT}, set at her launch, not in Settings.`,
    `Live: ${settings.live ? 'on, so house alerts reach her' : 'off, so house alerts do not reach her'}.`,
    `Her delivery note: ${settings.deliveryNote === '' ? '(none)' : settings.deliveryNote}.`,
    `Her talk button: ${settings.talkBinding === null ? 'none bound' : settings.talkBinding.label}.`,
    `Her register: ${characterCount(settings.register).toLocaleString('en-US')} characters, ${original ? 'the original' : 'edited from the original'}.`,
  ];
}

/**
 * `voice`: how his speech is heard (the home server first, Gemini the backup, for the chat's mic and her press alike, and whether the home
 * server is set up), the chat's read-aloud provider, whether transcripts are cleaned of fillers and repeats, the backup's transcription model,
 * the speech model, her voice, her sounds, and whose Gemini key is in use.
 * `source` is `GeminiKeyStatus['source']` and `homeServerKey` is `HomeServerKeyStatus['source']`, and nothing else of either status.
 */
export function voiceSettingsLines(voice: VoiceSettings, source: GeminiKeyStatus['source'], homeServerKey: HomeServerKeyStatus['source']): string[] {
  const homeServerSet = voice.homeServer.address !== null && homeServerKey === 'stored';
  return [
    `How he is heard (the chat mic and her talk press): ${homeServerSet ? 'his home server transcribes it, with Gemini as the backup when the home server cannot' : 'the home server is not set up, so Gemini transcribes it'}.`,
    `Chat read-aloud provider: ${PROVIDER_WORDS[voice.provider]}.`,
    `Transcript cleanup: ${voice.cleanTranscripts ? 'on, so um, uh and repeated words are removed from what he says' : 'off, so his fillers, stutters and repeats are kept as said (the vocabulary still corrects his house words)'}.`,
    `Backup transcription model (Gemini's): ${voice.gemini.transcriptionModel}.`,
    `Speech model: ${voice.gemini.speechModel}.`,
    `Her voice: ${voice.gemini.voice}.`,
    `Her sounds: ${voice.gemini.soundTags.join(', ')}.`,
    `Gemini key in use: ${KEY_WORDS[source]}.`,
  ];
}
