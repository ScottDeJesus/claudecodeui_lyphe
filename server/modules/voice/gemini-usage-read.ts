import { rateFor } from '@/modules/gemini-meter/index.js';
import type { GeminiUsage } from '@/modules/gemini-meter/index.js';

/**
 * What one answer from Google says it cost, read from the copy of its bytes the wire (`gemini-wire.ts`) keeps: Google's own
 * usage when the answer carried it, and the bytes of audio an event stream delivered, from which a speech call's output is
 * derived when it carried none. Pure: no I/O, never throws for a body it cannot read (that is "no usage").
 */

export type UsageRead = { usage: GeminiUsage | null; audioBytes: number };

/** The speech door asks for PCM at 24 kHz, 16-bit, mono: 48,000 bytes a second of speech. */
const PCM_BYTES_PER_SECOND = 48_000;
const AUDIO_MODALITY = 'audio';

type JsonObject = Record<string, unknown>;

/**
 * The usage an answer carried. A JSON answer (`generateContent`): `usageMetadata`, input `promptTokenCount`, output
 * `candidatesTokenCount` plus `thoughtsTokenCount`, the AUDIO entries of `promptTokensDetails` and `candidatesTokensDetails`
 * as the audio part, and with no input breakdown the whole input as audio (the transcribing door sends a clip). An event
 * stream (the Interactions API): the last event's `usage`, input `total_input_tokens`, output `total_output_tokens` plus
 * `total_thought_tokens`, the audio entries of its by-modality lists, and with no output breakdown the whole output as audio
 * (the speaking door asks for audio alone); and the bytes of audio its deltas carried. A usage whose totals are both zero is
 * no usage: absence of measurement is never recorded as zero cost.
 */
export function usageOf(contentType: string, copy: Uint8Array): UsageRead {
  const text = new TextDecoder().decode(copy);
  if (isEventStream(contentType, text)) return eventStreamUsage(text);
  return { usage: jsonUsage(parseObject(text)), audioBytes: 0 };
}

/**
 * The output of a speech call whose answer carried no usage, derived from the audio it delivered at the model's listed
 * audio tokens per second on that day; null (the call is counted, its tokens are not) for a model with no such rate or
 * for an answer that delivered no audio.
 */
export function deliveredSpeechUsage(model: string, audioBytes: number, at: Date): GeminiUsage | null {
  const tokensPerSecond = rateFor(model, at.toISOString().slice(0, 10))?.audioOutTokensPerSecond ?? null;
  if (tokensPerSecond === null || audioBytes <= 0) return null;
  const tokens = Math.round((audioBytes / PCM_BYTES_PER_SECOND) * tokensPerSecond);
  return { inputTokens: 0, outputTokens: tokens, inputAudioTokens: 0, outputAudioTokens: tokens };
}

function isEventStream(contentType: string, text: string): boolean {
  return /text\/event-stream/i.test(contentType) || /^(?:event|data):/.test(text.trimStart());
}

function jsonUsage(reply: JsonObject | null): GeminiUsage | null {
  const meta = reply?.usageMetadata;
  if (!isRecord(meta)) return null;
  const inputTokens = tokenCount(meta.promptTokenCount);
  const outputTokens = tokenCount(meta.candidatesTokenCount) + tokenCount(meta.thoughtsTokenCount);
  if (inputTokens + outputTokens === 0) return null;
  return {
    inputTokens,
    outputTokens,
    inputAudioTokens: Array.isArray(meta.promptTokensDetails) ? audioTokensOf(meta.promptTokensDetails) : inputTokens,
    outputAudioTokens: Array.isArray(meta.candidatesTokensDetails) ? audioTokensOf(meta.candidatesTokensDetails) : 0,
  };
}

function eventStreamUsage(text: string): UsageRead {
  let usage: JsonObject | null = null;
  let audioBytes = 0;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = parseObject(dataOf(block));
    if (data === null) continue;
    audioBytes += audioBytesOf(data.delta);
    usage = usageIn(data) ?? usage;
  }
  return { usage: usage === null ? null : streamUsage(usage), audioBytes };
}

/** The `data:` lines of one server-sent event, joined as the protocol joins them. */
function dataOf(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''))
    .join('\n');
}

function audioBytesOf(delta: unknown): number {
  if (!isRecord(delta) || delta.type !== AUDIO_MODALITY || typeof delta.data !== 'string') return 0;
  return Buffer.from(delta.data, 'base64').length;
}

/** The usage an event carries: on the event itself, or on the interaction a terminal event closes. */
function usageIn(data: JsonObject): JsonObject | null {
  if (isRecord(data.usage)) return data.usage;
  if (isRecord(data.interaction) && isRecord(data.interaction.usage)) return data.interaction.usage;
  return null;
}

function streamUsage(usage: JsonObject): GeminiUsage | null {
  const inputTokens = tokenCount(usage.total_input_tokens);
  const outputTokens = tokenCount(usage.total_output_tokens) + tokenCount(usage.total_thought_tokens);
  if (inputTokens + outputTokens === 0) return null;
  const inputByModality = modalityList(usage, 'input');
  const outputByModality = modalityList(usage, 'output');
  return {
    inputTokens,
    outputTokens,
    inputAudioTokens: inputByModality === null ? 0 : audioTokensOf(inputByModality),
    outputAudioTokens: outputByModality === null ? outputTokens : audioTokensOf(outputByModality),
  };
}

/** The by-modality list of one side (`input` or `output`), whatever the API names it. */
function modalityList(usage: JsonObject, side: 'input' | 'output'): unknown[] | null {
  for (const [name, value] of Object.entries(usage)) {
    if (name.includes(side) && name.includes('modality') && Array.isArray(value)) return value;
  }
  return null;
}

/** The tokens of the audio entries of a modality breakdown (`{ modality, tokenCount | tokens | token_count }`). */
function audioTokensOf(entries: unknown[]): number {
  let total = 0;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.modality !== 'string' || entry.modality.toLowerCase() !== AUDIO_MODALITY) continue;
    total += tokenCount(entry.tokenCount ?? entry.tokens ?? entry.token_count);
  }
  return total;
}

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function parseObject(text: string): JsonObject | null {
  if (!text.trim()) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
