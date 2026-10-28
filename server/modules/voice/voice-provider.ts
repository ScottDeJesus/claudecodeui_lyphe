import type { VoiceAudioUpload, VoiceRequestOverrides, VoiceService, VoiceServiceResult } from '@/shared/types.js';

import { transcribeWithGemini } from './gemini-transcribe.js';
import { readVoiceSettings } from './voice-settings.js';

/**
 * Builds the routes' one decision: which backend transcribes the chat composer's mic for this account. The
 * account's provider `gemini` goes to the Gemini door; `openai` goes to the OpenAI-compatible proxy exactly as it
 * always did, still reading the browser's `x-voice-*` headers (`overrides`). The Gemini door's three refusals are
 * mapped to the status the route answers with: no key and a refused key are 409 (the person can fix both in
 * Settings → Voice), a failed call is 502. `GET /api/voice/health` is not part of this decision: it answers the
 * proxy's own `configured` for every account, because its one reader is the page's `useVoiceAvailable('speak')`
 * (read-aloud, which stays on the OpenAI-compatible backend); the composer's mic follows the provider the page
 * reads from `GET /api/voice/settings`.
 * Consumed by `voice.module.ts`, which hands it to the router for `POST /api/voice/transcribe`.
 */
export function createVoiceProvider(voiceService: VoiceService) {
  return {
    async transcribeForChat(
      userId: number,
      audio: VoiceAudioUpload,
      overrides: VoiceRequestOverrides,
    ): Promise<VoiceServiceResult<{ text: string }>> {
      if (readVoiceSettings(userId).provider !== 'gemini') {
        return voiceService.transcribe({ audio, overrides });
      }

      const answer = await transcribeWithGemini(userId, audio);
      if (answer.ok) return { ok: true, value: { text: answer.text } };
      return { ok: false, status: answer.reason === 'failed' ? 502 : 409, error: answer.sentence };
    },
  };
}
