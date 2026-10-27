import { Readable } from 'node:stream';

import express from 'express';

import type { VoiceRequestOverrides, VoiceService, VoiceServiceResult } from '@/shared/types.js';
import { asyncHandler, readAuthenticatedUserId } from '@/shared/utils.js';

import { clearGeminiKey, geminiKeyStatus, saveGeminiKey } from './gemini-key.js';
import type { createVoiceProvider } from './voice-provider.js';
import { readVoiceSettings, saveVoiceSettings } from './voice-settings.js';

type VoiceRouterDependencies = {
  voiceService: VoiceService;
  voiceProvider: ReturnType<typeof createVoiceProvider>;
  parseAudioUpload: express.RequestHandler;
};

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  const trimmedValue = normalizedValue?.trim();
  return trimmedValue || undefined;
}

function parseVoiceOverrides(request: express.Request): VoiceRequestOverrides {
  return {
    apiKey: readHeaderValue(request.headers['x-voice-api-key']),
    sttModel: readHeaderValue(request.headers['x-voice-stt-model']),
    ttsModel: readHeaderValue(request.headers['x-voice-tts-model']),
    ttsVoice: readHeaderValue(request.headers['x-voice-tts-voice']),
    ttsFormat: readHeaderValue(request.headers['x-voice-tts-format']),
  };
}

function sendFailure<TValue>(
  response: express.Response,
  result: VoiceServiceResult<TValue>,
): result is Extract<VoiceServiceResult<TValue>, { ok: false }> {
  if (result.ok) {
    return false;
  }

  response.status(result.status).json({ error: result.error });
  return true;
}

/**
 * Creates the transport-only router for the Voice composition root (`voice.module.ts`), which hands it the proxy
 * service, the provider decision and the upload parser. Other modules consume only the composed router exposed
 * from the Voice barrel.
 */
export function createVoiceRouter(dependencies: VoiceRouterDependencies): express.Router {
  const router = express.Router();

  // The OpenAI-compatible proxy's own answer, whatever the account's provider: read-aloud draws its speaker from it.
  router.get('/health', (_request, response) => {
    response.json(dependencies.voiceService.getHealth());
  });

  // The account's voice settings and its one Gemini key. The key is never answered, only its status: where it
  // comes from and, for a stored key, its last four characters.
  router.get('/settings', asyncHandler(async (request, response) => {
    const userId = readAuthenticatedUserId(request);
    response.json({ settings: readVoiceSettings(userId), key: geminiKeyStatus(userId) });
  }));

  router.put('/settings', asyncHandler(async (request, response) => {
    const userId = readAuthenticatedUserId(request);
    const settings = saveVoiceSettings(userId, request.body);
    response.json({ settings, key: geminiKeyStatus(userId) });
  }));

  router.put('/gemini-key', asyncHandler(async (request, response) => {
    const userId = readAuthenticatedUserId(request);
    // A body without a string `key` is handed on as an empty one, which the save refuses naming `key`.
    const key: unknown = request.body?.key;
    response.json({ key: saveGeminiKey(userId, typeof key === 'string' ? key : '') });
  }));

  router.delete('/gemini-key', asyncHandler(async (request, response) => {
    response.json({ key: clearGeminiKey(readAuthenticatedUserId(request)) });
  }));

  router.post('/transcribe', (request, response, next) => {
    dependencies.parseAudioUpload(request, response, (uploadError?: unknown) => {
      if (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
        response.status(400).json({ error: message });
        return;
      }

      // Multer uses a callback API, so bridge its parsed request into the async
      // service call and forward unexpected rejections to Express middleware.
      void (async () => {
        if (!request.file) {
          response.status(400).json({ error: 'No audio uploaded' });
          return;
        }

        // Which backend hears the clip is the account's provider setting; the x-voice-* headers matter only on the OpenAI-compatible branch.
        const result = await dependencies.voiceProvider.transcribeForChat(
          readAuthenticatedUserId(request),
          {
            bytes: request.file.buffer,
            mimeType: request.file.mimetype || 'audio/webm',
            fileName: request.file.originalname || 'recording.webm',
          },
          parseVoiceOverrides(request),
        );

        if (sendFailure(response, result)) {
          return;
        }

        response.json(result.value);
      })().catch(next);
    });
  });

  router.post('/tts', asyncHandler(async (request, response) => {
    const text = request.body?.text;
    if (typeof text !== 'string' || !text.trim()) {
      response.status(400).json({ error: 'text required' });
      return;
    }

    const result = await dependencies.voiceService.synthesizeSpeech({
      text,
      overrides: parseVoiceOverrides(request),
    });
    if (sendFailure(response, result)) {
      return;
    }

    response.setHeader('Content-Type', result.value.contentType);
    response.setHeader('Cache-Control', 'no-store');
    if (!result.value.body) {
      response.end();
      return;
    }

    Readable.fromWeb(result.value.body).on('error', (error) => response.destroy(error)).pipe(response);
  }));

  return router;
}
