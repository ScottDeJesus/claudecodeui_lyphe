import multer from 'multer';

import { createSpeechTranscriber } from './speech-transcriber.js';
import { createVoiceProvider } from './voice-provider.js';
import { createVoiceRouter } from './voice.routes.js';
import { createVoiceService } from './voice.service.js';

const DEFAULT_VOICE_TIMEOUT_MS = 300_000;
const parsedTimeoutMs = Number(process.env.VOICE_TIMEOUT_MS);
const voiceTimeoutMs = Number.isFinite(parsedTimeoutMs) && parsedTimeoutMs > 0
  ? parsedTimeoutMs
  : DEFAULT_VOICE_TIMEOUT_MS;

const voiceService = createVoiceService({
  defaults: {
    // The server-controlled URL is intentional: frontend-configured custom
    // backends are called directly by the browser and never become SSRF input.
    baseUrl: (process.env.VOICE_API_BASE_URL || '').replace(/\/$/, ''),
    apiKey: process.env.VOICE_API_KEY || '',
    sttModel: process.env.VOICE_STT_MODEL || 'whisper-1',
    ttsModel: process.env.VOICE_TTS_MODEL || 'tts-1',
    ttsVoice: process.env.VOICE_TTS_VOICE || 'alloy',
  },
  timeoutMs: voiceTimeoutMs,
  fetchBackend: async (url, options) => {
    // A call that brings its own deadline (a transcription: the whole exchange, body read included) is not given a second one
    // that stops at the headers.
    if (options.signal) return fetch(url, { redirect: 'manual', ...options });

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => abortController.abort(), voiceTimeoutMs);
    try {
      return await fetch(url, {
        redirect: 'manual',
        ...options,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  },
});

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/**
 * Hears one clip: the account's home server first, Gemini the backup (`speech-transcriber.ts`). The chat mic's route and the
 * companion's press (through the voice barrel) both come through this one function, so they cannot hear differently.
 */
export const transcribeSpeech = createSpeechTranscriber(voiceService);

/** Voice router assembled for the server entrypoint. */
export const voiceRoutes = createVoiceRouter({
  voiceProvider: createVoiceProvider(voiceService, transcribeSpeech),
  parseAudioUpload: audioUpload.single('audio'),
});
