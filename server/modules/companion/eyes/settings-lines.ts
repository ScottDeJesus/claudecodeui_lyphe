import type { CompanionSettings } from '@/shared/companion-types.js';
import type { GeminiKeyStatus, VoiceSettings } from '@/shared/types.js';

import { characterCount } from '../companion-input.js';

/**
 * Her settings and the voice's, for `read_settings` (`house-reads.ts`), as one line per setting. PURE — the settings arrive as
 * values. Nothing here is written back: `read_settings` reads, and no tool of hers writes his settings.
 *
 * NEVER A KEY. The Gemini key is said by whose it is and by nothing of it: `GeminiKeyStatus.last4` is not read in this file,
 * so not even the last characters of a key of his can reach her context.
 *
 * Consumer: `house-reads.ts` (`read_settings`).
 */

/** The Gemini key in use, by the status's `source`: his own, the house's, or none. The one sentence a key is ever said in. */
const KEY_WORDS: Readonly<Record<GeminiKeyStatus['source'], string>> = {
  stored: 'a key of yours',
  house: "the house's key",
  none: 'no key',
};

/** The chat mic's provider by its name. */
const PROVIDER_WORDS: Readonly<Record<VoiceSettings['provider'], string>> = { openai: 'OpenAI', gemini: 'Gemini' };

/**
 * `companion`: her name and his, her model by the label the picker shows, Live on or off, her delivery note, her talk button's
 * label, and her register's length with whether it is the original. `originalRegister` is the product's template
 * (`COMPANION_REGISTER_DEFAULT`); a register equal to it, ends trimmed, is the original, because the settings store trims a text.
 */
export function companionSettingsLines(settings: CompanionSettings, modelLabel: string, originalRegister: string): string[] {
  const original = settings.register.trim() === originalRegister.trim();
  return [
    `Her name: ${settings.name}. His name, as she says it: ${settings.operatorName}.`,
    `Her model: ${modelLabel}.`,
    `Live: ${settings.live ? 'on, so house alerts reach her' : 'off, so house alerts do not reach her'}.`,
    `Her delivery note: ${settings.deliveryNote === '' ? '(none)' : settings.deliveryNote}.`,
    `Her talk button: ${settings.talkBinding === null ? 'none bound' : settings.talkBinding.label}.`,
    `Her register: ${characterCount(settings.register).toLocaleString('en-US')} characters, ${original ? 'the original' : 'edited from the original'}.`,
  ];
}

/**
 * `voice`: the chat mic's provider, the transcription and speech models, her voice, her sounds, and whose Gemini key is in use.
 * `source` is `GeminiKeyStatus['source']` and nothing else of the status.
 */
export function voiceSettingsLines(voice: VoiceSettings, source: GeminiKeyStatus['source']): string[] {
  return [
    `Chat mic provider: ${PROVIDER_WORDS[voice.provider]}.`,
    `Transcription model: ${voice.gemini.transcriptionModel}.`,
    `Speech model: ${voice.gemini.speechModel}.`,
    `Her voice: ${voice.gemini.voice}.`,
    `Her sounds: ${voice.gemini.soundTags.join(', ')}.`,
    `Gemini key in use: ${KEY_WORDS[source]}.`,
  ];
}
