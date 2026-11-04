import type { VoiceAudioUpload, VoiceRequestOverrides, VoiceService, VoiceServiceResult, VoiceSpeechPayload } from '@/shared/types.js';

import { chatStatusForRefusal } from './gemini-errors.js';
import { geminiKeyStatus } from './gemini-key.js';
import { synthesizeReadAloud } from './gemini-read-aloud.js';
import { transcribeWithGemini } from './gemini-transcribe.js';
import { cleanTranscript } from './transcript-cleanup.js';
import { whisperVocabularyPrompt } from './vocabulary-hints.js';
import { readVocabulary } from './vocabulary.js';
import { respellForSpeech } from './vocabulary-match.js';
import { readVoiceSettings } from './voice-settings.js';

/**
 * Builds the routes' one decision: which backend hears and speaks the chat for this account. The account's provider `gemini`
 * (the default) goes to the Gemini doors, for the composer's mic and for read-aloud alike; `openai` goes to the OpenAI-compatible
 * proxy exactly as it always did, still reading the browser's `x-voice-*` headers (`overrides`). The clip goes with the account's
 * vocabulary as Whisper's `prompt` (it takes no instruction), and its text comes back cleaned of fillers and repeats when the
 * account's `cleanTranscripts` is on and with every misheard house word corrected whatever that switch says (the Gemini door does its
 * own, once). The Gemini door's three refusals are mapped to the status the route answers with (`chatStatusForRefusal`): no key and
 * a refused key are 409 (the person can fix both in Settings → Voice), a failed call is 502.
 *
 * `synthesizeForChat` is read-aloud. On `gemini` the server speaks it (`synthesizeReadAloud`: Kaylee's speech door, in the account's
 * Gemini speech model and voice, the text respelled there by the vocabulary, answered as one WAV); on `openai` it is the proxy's
 * speech, asked for the text with each house word respelled the way it is said (`respellForSpeech`), so the person's screen keeps
 * the spelling. `healthForChat` answers `GET /api/voice/health`, the page's one reader being `useVoiceAvailable('speak')`: on
 * `gemini` whether the account has a Gemini key in reach (`geminiKeyStatus`), on `openai` the proxy's own `configured`.
 *
 * The browser may hear and speak on its own OpenAI-compatible endpoint (`src/shared/api.ts`: `transcribeVoice`,
 * `synthesizeVoice`), a call this server never sees, and only for an account on `openai`. Three methods hand it the same engine
 * without a copy of it in the page: `transcribeHintsForChat` is the Whisper `prompt` the browser puts on its clip,
 * `cleanTranscriptForChat` is what a transcript passes through (the very `cleanTranscript` call the OpenAI branch above makes,
 * with the account's switch and vocabulary), and `speakableForChat` is the text respelled for speech. They also serve a standalone
 * dictation app that talks to its own backend. None of the three reaches a backend or reads a key.
 * Consumed by `voice.module.ts`, which hands it to the router for `GET /api/voice/health`, `POST /api/voice/transcribe`,
 * `POST /api/voice/tts`, `GET /api/voice/transcribe-hints`, `POST /api/voice/clean` and `POST /api/voice/speakable`.
 */
export function createVoiceProvider(voiceService: VoiceService) {
  // One respelling for the proxy's read-aloud and for `POST /api/voice/speakable`, so the two cannot drift apart.
  const speakableText = (userId: number, text: string): string => respellForSpeech(text, readVocabulary(userId));

  return {
    async transcribeForChat(
      userId: number,
      audio: VoiceAudioUpload,
      overrides: VoiceRequestOverrides,
    ): Promise<VoiceServiceResult<{ text: string }>> {
      const { provider, cleanTranscripts } = readVoiceSettings(userId);
      if (provider !== 'gemini') {
        const vocabulary = readVocabulary(userId);
        const result = await voiceService.transcribe({ audio, overrides, prompt: whisperVocabularyPrompt(vocabulary) });
        // Whisper has no instruction to give, so its text is cleaned and corrected here, after the service has answered.
        return result.ok
          ? { ok: true, value: { ...result.value, text: cleanTranscript(result.value.text, { removeFillers: cleanTranscripts, vocabulary }) } }
          : result;
      }

      const answer = await transcribeWithGemini(userId, audio);
      if (answer.ok) return { ok: true, value: { text: answer.text } };
      return { ok: false, status: chatStatusForRefusal(answer.reason), error: answer.sentence };
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

    // Read fresh per call, like every read of the vocabulary: a word saved in Settings applies on the next press.
    transcribeHintsForChat(userId: number): { prompt: string } {
      return { prompt: whisperVocabularyPrompt(readVocabulary(userId)) };
    },

    cleanTranscriptForChat(userId: number, text: string): string {
      const { cleanTranscripts } = readVoiceSettings(userId);
      return cleanTranscript(text, { removeFillers: cleanTranscripts, vocabulary: readVocabulary(userId) });
    },

    speakableForChat(userId: number, text: string): string {
      return speakableText(userId, text);
    },
  };
}
