import { Readable } from 'node:stream';

import express from 'express';

import type { VoiceRequestOverrides, VoiceServiceResult } from '@/shared/types.js';
import { asyncHandler, readAuthenticatedUserId } from '@/shared/utils.js';

import { clearGeminiKey, geminiKeyStatus, saveGeminiKey } from './gemini-key.js';
import { clearHomeServerKey, homeServerKeyStatus, saveHomeServerKey } from './home-server-key.js';
import { readVocabulary, saveVocabulary } from './vocabulary.js';
import type { createVoiceProvider } from './voice-provider.js';
import { readVoiceSettings, saveVoiceSettings } from './voice-settings.js';

type VoiceRouterDependencies = {
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

// The longest `text` `POST /speakable` takes: the app's JSON limit is 50 MB, and the respelling walks every house word over the whole
// text on the server's one loop. 100,000 characters is some two hours of speech, far past any message; the page treats a refusal as
// "go on without the engine" and speaks the text as written.
const MAX_ENGINE_TEXT_CHARS = 100_000;

// The `text` of a JSON body, or null after answering 400 `text required` (no string `text`) or 413 `text too long`. An empty string
// is a text, and respelling it is a no-op.
function readTextBody(request: express.Request, response: express.Response): string | null {
  const text: unknown = request.body?.text;
  if (typeof text !== 'string') {
    response.status(400).json({ error: 'text required' });
    return null;
  }
  if (text.length > MAX_ENGINE_TEXT_CHARS) {
    response.status(413).json({ error: 'text too long' });
    return null;
  }
  return text;
}

/**
 * Creates the transport-only router for the Voice composition root (`voice.module.ts`), which hands it the provider decision
 * (the chat mic's try-then-backup transcriber and read-aloud) and the upload parser. Other modules consume only the composed router
 * exposed from the Voice barrel.
 */
export function createVoiceRouter(dependencies: VoiceRouterDependencies): express.Router {
  const router = express.Router();

  // Whether read-aloud has a backend for THIS account: its Gemini key on `gemini`, the OpenAI-compatible proxy's own `configured` on
  // `openai`. The page's `useVoiceAvailable('speak')` draws the read-aloud button from it.
  router.get('/health', asyncHandler(async (request, response) => {
    response.json(dependencies.voiceProvider.healthForChat(readAuthenticatedUserId(request)));
  }));

  // The account's voice settings and its two keys, Gemini's (`key`) and the home server's (`homeServerKey`). A key is never
  // answered, only its status: where it comes from and, for a stored key, its last four characters.
  router.get('/settings', asyncHandler(async (request, response) => {
    const userId = readAuthenticatedUserId(request);
    response.json({ settings: readVoiceSettings(userId), key: geminiKeyStatus(userId), homeServerKey: homeServerKeyStatus(userId) });
  }));

  router.put('/settings', asyncHandler(async (request, response) => {
    const userId = readAuthenticatedUserId(request);
    const settings = saveVoiceSettings(userId, request.body);
    response.json({ settings, key: geminiKeyStatus(userId), homeServerKey: homeServerKeyStatus(userId) });
  }));

  // The account's house words, one whole list: the misheard-word table every transcription and Kaylee's speech read. The PUT
  // replaces the list (a refused one is a 400 whose sentence names the entry or form) and answers it as stored; a standalone
  // dictation app reads the same list with the GET.
  router.get('/vocabulary', asyncHandler(async (request, response) => {
    response.json({ vocabulary: readVocabulary(readAuthenticatedUserId(request)) });
  }));

  router.put('/vocabulary', asyncHandler(async (request, response) => {
    response.json({ vocabulary: saveVocabulary(readAuthenticatedUserId(request), request.body?.vocabulary) });
  }));

  // The half of speech the browser may have run on its own OpenAI-compatible endpoint (a call this server never sees), answered by the one
  // engine the server's own paths run, so a page keeps no copy of the matching. `POST /speakable { text }` is the text to hand a speech
  // backend, each house word respelled as it is said. It calls no backend. A body without a string `text` is a 400, one over
  // `MAX_ENGINE_TEXT_CHARS` a 413.
  router.post('/speakable', asyncHandler(async (request, response) => {
    const userId = readAuthenticatedUserId(request);
    const text = readTextBody(request, response);
    if (text === null) return;
    response.json({ text: dependencies.voiceProvider.speakableForChat(userId, text) });
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

  // The account's one home server key, the same two doors as the Gemini key's: the key goes in once and only its status comes back.
  router.put('/home-server-key', asyncHandler(async (request, response) => {
    const userId = readAuthenticatedUserId(request);
    const key: unknown = request.body?.key;
    response.json({ homeServerKey: saveHomeServerKey(userId, typeof key === 'string' ? key : '') });
  }));

  router.delete('/home-server-key', asyncHandler(async (request, response) => {
    response.json({ homeServerKey: clearHomeServerKey(readAuthenticatedUserId(request)) });
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

        // The account's home server hears the clip first and Gemini only when it cannot; the answer is `{ text }` and, when Gemini stood in, a `notice` line.
        const result = await dependencies.voiceProvider.transcribeForChat(
          readAuthenticatedUserId(request),
          {
            bytes: request.file.buffer,
            mimeType: request.file.mimetype || 'audio/webm',
            fileName: request.file.originalname || 'recording.webm',
          },
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

    // A page that drops the request (Stop, another message) ends the speech calls behind it: a finished response closes too, which is then no abort.
    const dropped = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) dropped.abort();
    });
    const result = await dependencies.voiceProvider.synthesizeForChat(
      readAuthenticatedUserId(request),
      text,
      parseVoiceOverrides(request),
      dropped.signal,
    );
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
