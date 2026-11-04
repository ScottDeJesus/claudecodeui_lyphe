import type { VoiceServiceResult, VoiceSpeechPayload } from '@/shared/types.js';

import { chatStatusForRefusal } from './gemini-errors.js';
import { synthesizeSentence } from './gemini-speech.js';

/**
 * The most characters one Gemini speech call is asked for. `synthesizeSentence` is built for a sentence of hers (it gives a call
 * 60 s from the ask to the last byte), so a whole reply is cut into pieces that stay well inside that: about 40 s of speech each.
 */
const PIECE_MAX_CHARS = 700;

/**
 * The longest message read aloud: nine pieces. The clip is whole before its first byte is sent and the pieces are spoken one after
 * another, so the page waits for their sum. The house journal's real speech calls of 120+ characters run at about 38 ms per character
 * (median) to 44 ms (75th percentile): 6,000 characters wait about 230 s to 260 s, under the 330 s the page gives up at
 * (`voicePlayer.ts`, `CLIENT_TIMEOUT_MS`). 8,000 characters projected to 300 s to 350 s, which is a coin toss against that limit.
 */
const MESSAGE_MAX_CHARS = 6_000;

/**
 * Where a piece may end, most wanted first: after a blank line, after a line break (a list is cut between its items, never inside one),
 * after the end of a sentence (a Latin stop and its closing quotes and brackets, then a space; or the full-width 。！？ that CJK text
 * has no space after), at any space.
 */
const PIECE_BOUNDARIES = [/\n\s*\n/g, /\n/g, /[.!?…]["'”’)\]]*\s|[。！？]["'”’）」』)\]]*/g, /\s/g];

/** What `SpeechChunk` is (`server/shared/types.ts`): Int16 mono PCM at 24 kHz. The clip's WAV header says so. */
const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2;

/** `499`, nginx's "the client closed the request": nobody reads the answer, but the route still owes one. */
const CLIENT_CLOSED_STATUS = 499;

/** Where to cut the front of `window`: after the last wanted boundary in its second half, else (a block with none) at the window's end, never between the two halves of a surrogate pair (an emoji). */
function cutPoint(window: string): number {
  for (const boundary of PIECE_BOUNDARIES) {
    let cut = 0;
    for (const match of window.matchAll(boundary)) cut = match.index + match[0].length;
    // A boundary in the first half would make a short piece and leave a long rest, so the next kind of boundary is tried instead.
    if (cut > window.length / 2) return cut;
  }
  const lastUnit = window.charCodeAt(window.length - 1);
  return lastUnit >= 0xd800 && lastUnit <= 0xdbff ? window.length - 1 : window.length;
}

/** The text as pieces of at most `PIECE_MAX_CHARS`, in order, each cut at the best boundary its window holds. */
function splitIntoPieces(text: string): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > PIECE_MAX_CHARS) {
    const cut = cutPoint(rest.slice(0, PIECE_MAX_CHARS));
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * The PCM as one WAV file: a 44-byte header (RIFF, PCM, mono, 24 kHz, 16 bit) naming the exact length, then the samples. The chat's
 * player (`voicePlayer.ts`) hands the whole response to an `<audio>` element as a blob, so the length is known and a streaming
 * header (its sizes left open) is not needed.
 */
function wavOf(pcm: readonly Uint8Array[]): Buffer {
  const dataLength = pcm.reduce((sum, piece) => sum + piece.length, 0);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return Buffer.concat([header, ...pcm]);
}

/**
 * A chat message spoken through Gemini, for an account whose provider is `gemini`: the whole clip as one `audio/wav` payload, in the
 * account's Gemini speech model and voice, on its key (else the house's). Each piece of the message goes through `synthesizeSentence`,
 * the door Kaylee speaks through, with no delivery note, so the house words are respelled there exactly as hers are (a multi-word spelling that a cut falls inside is the one miss: each piece is respelled alone) and nothing of
 * the respelling is copied here. The pieces are spoken one after another and joined, so the clip is whole before the first byte is
 * sent. NOT COUNTED against any Gemini budget (INV-9908), like every call of that door.
 * Answers like the OpenAI-compatible proxy does (`VoiceServiceResult`), so the `/tts` route sends either without knowing which: a
 * refusal or failure of the door carries the door's own sentence (409 for a missing or refused key, 502 for anything else); a message
 * over `MESSAGE_MAX_CHARS` is a 413 with a sentence, and a request the client dropped (`signal`) stops the calls at once.
 * Consumed by `voice-provider.ts` (`synthesizeForChat`).
 */
export async function synthesizeReadAloud(userId: number, text: string, signal: AbortSignal): Promise<VoiceServiceResult<VoiceSpeechPayload>> {
  if (text.length > MESSAGE_MAX_CHARS) {
    return { ok: false, status: 413, error: `This message is too long to read aloud (over ${MESSAGE_MAX_CHARS.toLocaleString('en-US')} characters).` };
  }

  const pcm: Uint8Array[] = [];
  for (const piece of splitIntoPieces(text)) {
    const answer = await synthesizeSentence(userId, { text: piece, style: '', signal });
    if (!answer.ok) return { ok: false, status: chatStatusForRefusal(answer.reason), error: answer.sentence };
    try {
      for await (const chunk of answer.chunks) pcm.push(chunk);
    } catch (error) {
      // A failure after audio began: the stream throws an Error whose message is the door's own sentence.
      return { ok: false, status: chatStatusForRefusal('failed'), error: error instanceof Error ? error.message : String(error) };
    }
    // An abort ends a stream quietly, so a half-spoken clip would otherwise read as a whole one.
    if (signal.aborted) return { ok: false, status: CLIENT_CLOSED_STATUS, error: 'Read-aloud was cancelled.' };
  }

  const clip = wavOf(pcm);
  return {
    ok: true,
    value: {
      contentType: 'audio/wav',
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(clip);
          controller.close();
        },
      }),
    },
  };
}
