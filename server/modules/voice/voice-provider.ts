import type { VoiceAudioUpload, VoiceRequestOverrides, VoiceService, VoiceServiceResult, VoiceSpeechPayload } from '@/shared/types.js';

import { chatStatusForRefusal } from './gemini-errors.js';
import { geminiKeyStatus } from './gemini-key.js';
import { synthesizeReadAloud } from './gemini-read-aloud.js';
import type { createSpeechTranscriber } from './speech-transcriber.js';
import { readVocabulary } from './vocabulary.js';
import { respellForSpeech } from './vocabulary-match.js';
import { readVoiceSettings } from './voice-settings.js';

/**
 * Builds the routes' decisions about the chat's voice for this account.
 *
 * `transcribeForChat` is the composer's mic: the clip goes to the one try-then-backup transcriber (`speech-transcriber.ts`: the
 * account's home server first, Gemini the backup), whatever the account's provider says; the provider no longer chooses who
 * transcribes. A heard clip answers its cleaned `text` and, only when Gemini stood in because the home server could not, a `notice`
 * (the one short line the composer shows where its mic's errors show). A clip neither could hear answers the sentence naming both,
 * with the status the route gives it (`chatStatusForRefusal`): no key and a refused key are 409 (the person can fix both in Settings →
 * Voice), a failed call is 502.
 *
 * `synthesizeForChat` is read-aloud, and the provider chooses it: on `gemini` the server speaks it (`synthesizeReadAloud`: Kaylee's
 * speech door, in the account's Gemini speech model and voice, the text respelled there by the vocabulary, answered as one WAV); on `openai` it is the
 * proxy's speech, still reading the browser's `x-voice-*` headers (`overrides`), asked for the text with each house word respelled
 * the way it is said (`respellForSpeech`), so the person's screen keeps the spelling. `healthForChat` answers `GET /api/voice/health`,
 * the page's one reader being `useVoiceAvailable('speak')`: on `gemini` whether the account has a Gemini key in reach
 * (`geminiKeyStatus`), on `openai` the proxy's own `configured`.
 *
 * The browser may speak on its own OpenAI-compatible endpoint (`src/shared/api.ts`: `synthesizeVoice`), a call this server never
 * sees, and only for an account on `openai`. `speakableForChat` hands it the same respelling engine without a copy of it in the page:
 * the text respelled for speech. It reaches no backend and reads no key.
 * Consumed by `voice.module.ts`, which hands it to the router for `GET /api/voice/health`, `POST /api/voice/transcribe`,
 * `POST /api/voice/tts` and `POST /api/voice/speakable`.
 */
export function createVoiceProvider(voiceService: VoiceService, transcribeSpeech: ReturnType<typeof createSpeechTranscriber>) {
  // One respelling for the proxy's read-aloud and for `POST /api/voice/speakable`, so the two cannot drift apart.
  const speakableText = (userId: number, text: string): string => respellForSpeech(text, readVocabulary(userId));

  return {
    async transcribeForChat(
      userId: number,
      audio: VoiceAudioUpload,
    ): Promise<VoiceServiceResult<{ text: string; notice?: string }>> {
      const heard = await transcribeSpeech(userId, audio);
      if (!heard.ok) return { ok: false, status: chatStatusForRefusal(heard.reason), error: heard.sentence };
      return { ok: true, value: heard.standIn === null ? { text: heard.text } : { text: heard.text, notice: heard.standIn } };
    },

    async synthesizeForChat(
      userId: number,
      text: string,
      overrides: VoiceRequestOverrides,
      signal: AbortSignal,
    ): Promise<VoiceServiceResult<VoiceSpeechPayload>> {
      // `signal` ends the Gemini calls when the page drops the request; the proxy times itself out. The Gemini door respells the text itself, so it is handed the text as written.
      if (readVoiceSettings(userId).provider === 'gemini') return synthesizeReadAloud(userId, text, signal);
      return voiceService.synthesizeSpeech({ text: speakableText(userId, text), overrides });
    },

    healthForChat(userId: number): { configured: boolean } {
      return readVoiceSettings(userId).provider === 'gemini'
        ? { configured: geminiKeyStatus(userId).source !== 'none' }
        : voiceService.getHealth();
    },

    speakableForChat(userId: number, text: string): string {
      return speakableText(userId, text);
    },
  };
}
