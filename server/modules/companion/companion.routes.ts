import express from 'express';
import type { Request, Response, Router } from 'express';
import multer from 'multer';

import { isRecord } from '@/shared/document-fields.js';
import { AppError, asyncHandler, readAuthenticatedUserId, readPathParam } from '@/shared/utils.js';

import {
  DRAFT_TEXT_MAX,
  MESSAGE_TEXT_MAX,
  inputInvalid,
  readBodyObject,
  readBodySentenceIndex,
  readBodyText,
  readBodyTurnId,
  readBodyWholeNumber,
  readClientId,
  readSentenceIndexParam,
  readTurnIdParam,
  requireClientId,
} from './companion-input.js';
import type { PressInput } from './companion-press.js';
import { type CompanionSettingsPatch } from './companion-settings.js';
import type { CompanionService } from './companion.service.js';

/**
 * Her door for the page: every route of the companion's table.
 * Mounted at `/api/companion` behind `authenticateToken` by the server entrypoint.
 *
 * ONLY TRANSPORT. A route here reads who is asking (`req.user`, which is her account) and which page (the
 * `x-companion-client` header), checks the SHAPE of what came (a body that is an object, a `text` of 1 to 8000
 * characters, an id that is a whole number), calls one service verb and answers. What a verb means — the
 * floor, the settings' limits, the draft that must be held — is the service's, and a refusal is the app's own
 * `AppError` envelope: `{ success: false, error: { code, message } }`, the 400 always `COMPANION_INPUT_INVALID`
 * with a sentence that names the field and its limit.
 *
 * AN ANSWER IS THE THING ITSELF, not wrapped: `GET /` answers the picture, `PUT /settings` the settings and
 * `PUT /draft` the draft, so a page folds them straight into what it holds. A write that has nothing to
 * say answers 204.
 *
 * THE PRESS DOOR, `POST /press`, is the one multipart route: the clip as `audio` and the page's own clock for it as
 * `durationMs`. It answers 202 `{ text }` — what he said as heard, `''` for the empty press — or the 409/502 of a
 * hearing that came to nothing (`companion-press.ts`).
 *
 * THE SPEECH DOOR is two routes (`companion-speech.ts`). `GET /speech/:turnId/:index` answers one of her sentences as raw
 * PCM — 200 `audio/l16; rate=24000; channels=1`, streamed as it is synthesized — to the page that holds the floor, 204 for a
 * sentence with nothing to say, and the AppError envelope for the refusals (404 no such sentence, 409 not the floor, 409
 * Google refused, 502 the call failed); a page that hangs up stops the synthesis. `POST /cut` is the press while she speaks.
 */

/** The longest clip the press door takes, in bytes: the voice module's own bound for an upload (`voice.module.ts`). */
const PRESS_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

/** The longest recording a page may claim, in ms: an hour. */
const PRESS_DURATION_MAX_MS = 3_600_000;

/** Audio/L16 at 24 kHz mono: the format of `synthesizeSentence`'s PCM, with the parameters a player needs to read it. */
const SPEECH_CONTENT_TYPE = 'audio/l16; rate=24000; channels=1';

const pressUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PRESS_AUDIO_MAX_BYTES } }).single('audio');

/**
 * Reads the press's multipart body into the typed input of the service, or the 400 naming the field that is wrong.
 * Multer's own refusals (a clip past the bound, a file under another field name, a body that is not well-formed
 * multipart) are the `audio` field's, because the clip is the part that could not be read.
 */
async function readPress(request: Request, response: Response): Promise<PressInput> {
  await new Promise<void>((resolve, reject) => {
    pressUpload(request, response, (failure?: unknown) => {
      if (failure === undefined || failure === null) return resolve();
      const reason = failure instanceof Error ? failure.message : String(failure);
      reject(inputInvalid(`audio must be one audio file of at most ${PRESS_AUDIO_MAX_BYTES / (1024 * 1024)} MB, sent as multipart (${reason}).`, 'audio'));
    });
  });
  const { file } = request;
  if (!file) throw inputInvalid('audio is required: the clip, as one multipart file named audio.', 'audio');
  const fields: Record<string, unknown> = isRecord(request.body) ? request.body : {};
  return {
    audio: { bytes: file.buffer, mimeType: file.mimetype || 'audio/webm', fileName: file.originalname || 'recording.webm' },
    durationMs: readBodyWholeNumber(fields, 'durationMs', 0, PRESS_DURATION_MAX_MS),
  };
}

/** Resolves when the socket has drained or the page has gone, and leaves neither listener behind (a long sentence waits on backpressure many times). */
function drainedOrClosed(response: Response): Promise<void> {
  return new Promise((resolve) => {
    const resume = (): void => {
      response.off('drain', resume);
      response.off('close', resume);
      resolve();
    };
    response.once('drain', resume);
    response.once('close', resume);
  });
}

/**
 * Writes the audio to the response as it arrives and ends it. The status is already on its way when the first piece is
 * written, so a stream that fails after that ends the response where the audio stopped; nothing more can be said to the page.
 * Stops reading when the page hangs up, and waits for the socket to drain between pieces.
 */
async function streamPcm(response: Response, chunks: AsyncIterable<Buffer>): Promise<void> {
  try {
    for await (const chunk of chunks) {
      if (response.destroyed) break;
      if (!response.write(chunk)) await drainedOrClosed(response);
    }
  } catch (error) {
    console.error('[companion] speech: the audio stream stopped before its end', error);
  } finally {
    response.end();
  }
}

/** A note's id from the path: a positive whole number, or the 400 that says so. */
function readNoteId(request: Request): number {
  const raw = readPathParam(request.params.id, 'id');
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw inputInvalid('id must be a whole number of 1 or more.', 'id');
  return Number(raw);
}

/** Consumed by `companion.module.ts`, which hands it the service. */
export function createCompanionRoutes(service: CompanionService): Router {
  const router = express.Router();

  // A page reads her whole picture; the client id is validated though unused, so a broken header is heard of on the first read.
  router.get(
    '/',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      response.json(await service.picture(readAuthenticatedUserId(request)));
    }),
  );

  router.post(
    '/messages',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      const client = requireClientId(request);
      const text = readBodyText(readBodyObject(request), 'text', MESSAGE_TEXT_MAX);
      service.sendText(userId, client, text);
      // Accepted, not answered: her sentences come back as frames on the page's socket.
      response.status(202).json({ accepted: true });
    }),
  );

  // The talk button's press. The page is named before the body is read, so a request with no client id costs no upload.
  router.post(
    '/press',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      const client = requireClientId(request);
      // Answered once the press has been pushed (or refused), so the page learns the words it said in this one answer.
      response.status(202).json(await service.press(userId, client, await readPress(request, response)));
    }),
  );

  // Express would answer a HEAD with the GET below, which would start a synthesis (and spend) for a response that carries no audio.
  router.head('/speech/:turnId/:index', (_request: Request, response: Response) => {
    response.set('Allow', 'GET').status(405).end();
  });

  // One of her sentences, as raw PCM, for the page that holds the floor. The page pulls: it asks for sentence k when k's frame has arrived.
  router.get(
    '/speech/:turnId/:index',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      const client = requireClientId(request);
      const turnId = readTurnIdParam(readPathParam(request.params.turnId, 'turnId'));
      const index = readSentenceIndexParam(readPathParam(request.params.index, 'index'));
      // 'close' fires however the response ended, so the abort is also the end of a finished request: the service leaves the sentence then.
      const hangup = new AbortController();
      response.on('close', () => hangup.abort());

      const reply = await service.speech(userId, client, { turnId, index }, hangup.signal);
      if (reply.kind === 'nothing') {
        response.status(204).end();
        return;
      }
      response.status(200).setHeader('Content-Type', SPEECH_CONTENT_TYPE);
      response.setHeader('Cache-Control', 'no-store');
      // Behind a buffering proxy the first sentence would arrive only when it was finished, which is what streaming is there to avoid.
      response.setHeader('X-Accel-Buffering', 'no');
      await streamPcm(response, reply.chunks);
    }),
  );

  // The press of the talk button while she speaks: the page stopped its player; this stops the rest. The 204 waits for her turn to
  // be interrupted (seconds, when her process is slow to answer), so the page records at once and does not wait on it.
  router.post(
    '/cut',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      readClientId(request);
      const body = readBodyObject(request);
      await service.cut(userId, {
        turnId: readBodyTurnId(body, 'turnId'),
        heard: readBodySentenceIndex(body, 'heard'),
        interrupted: readBodySentenceIndex(body, 'interrupted'),
      });
      response.status(204).end();
    }),
  );

  // The panel opened here: this page is the one she acts on.
  router.post(
    '/floor',
    asyncHandler(async (request: Request, response: Response) => {
      service.takeFloor(readAuthenticatedUserId(request), requireClientId(request));
      response.status(204).end();
    }),
  );

  router.put(
    '/settings',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      // The body is a partial of her settings, typed as one and checked as untyped all the same: the settings' own
      // save refuses a key that is not a setting and a value past its limit, naming the field.
      const patch = readBodyObject(request) as CompanionSettingsPatch;
      response.json(await service.saveSettings(readAuthenticatedUserId(request), patch));
    }),
  );

  router.put(
    '/draft',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      const userId = readAuthenticatedUserId(request);
      response.json(service.editDraft(userId, readBodyText(readBodyObject(request), 'text', DRAFT_TEXT_MAX)));
    }),
  );

  // Sends the draft as it stands. A refused send is a 409 carrying the sentence the card shows; the answer of a send is
  // what happened — a turn started, or the brief folded into the running one.
  router.post(
    '/draft/send',
    asyncHandler(async (request: Request, response: Response) => {
      const userId = readAuthenticatedUserId(request);
      const client = requireClientId(request);
      const { mode } = readBodyObject(request);
      if (mode !== 'turn' && mode !== 'steer') throw inputInvalid('mode must be "turn" or "steer".', 'mode');
      const sent = await service.sendDraft(userId, client, mode);
      if (sent.outcome === 'refused') throw new AppError(sent.sentence, { code: 'COMPANION_SEND_REFUSED', statusCode: 409 });
      response.json({ outcome: sent.outcome });
    }),
  );

  router.delete(
    '/draft',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      service.clearDraft(readAuthenticatedUserId(request));
      response.status(204).end();
    }),
  );

  router.delete(
    '/notes/:id',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      service.dismissNote(readAuthenticatedUserId(request), readNoteId(request));
      response.status(204).end();
    }),
  );

  router.post(
    '/interrupt',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      await service.interrupt(readAuthenticatedUserId(request));
      response.status(204).end();
    }),
  );

  router.post(
    '/clear',
    asyncHandler(async (request: Request, response: Response) => {
      readClientId(request);
      await service.clear(readAuthenticatedUserId(request));
      response.status(204).end();
    }),
  );

  return router;
}
