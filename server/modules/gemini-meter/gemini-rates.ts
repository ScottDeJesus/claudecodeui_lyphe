/**
 * Google's list prices for the Gemini models CloudCLI's voice can name (voice-settings.ts: the backup transcriber
 * gemini-3.8-flash, the speech model gemini-3.8-flash-tts, and gemini-3.8-flash-lite-tts, the cheap choice its page
 * names), in USD per million tokens, Standard tier, dated: a price applies from its from date (UTC) until the
 * family's next row. A new price is a NEW dated row, never an edit of an old one, so a past day keeps the price it
 * was spent at.
 *
 * The figures are the ones the house already prices these models at (/opt/shadow-connector/core/llm_pricing.py,
 * its _RATES and _CHANGES rows read from Google's pricing page), so CloudCLI's estimate and the connector's agree.
 * That table carries one input and one output rate per model; the audio rates here are those same figures, which is
 * what it charges: the speech models' output is the audio rate, and the transcriber's input one rate whatever it hears.
 *
 * A model is matched by the longest family prefix, as the house table does.
 */

export type GeminiRate = {
  /** The model family: an id this starts is priced by this row. */
  model: string;
  /** The UTC date (YYYY-MM-DD) the price took effect. */
  from: string;
  textInPerM: number;
  audioInPerM: number;
  textOutPerM: number;
  audioOutPerM: number;
  /** Audio tokens per second of speech the model returns, or null for a model that does not speak. */
  audioOutTokensPerSecond: number | null;
};

/** What costOf reads of a gemini_calls_daily row. */
export type PricedRow = {
  model: string;
  usage_date: string;
  input_tokens: number;
  output_tokens: number;
  input_audio_tokens: number;
  output_audio_tokens: number;
};

const TOKENS_PER_PRICED_UNIT = 1_000_000;
/** Before this the meter did not exist; every family's first row starts here. */
const LISTED_FROM = '2026-01-01';
/** Google's announced step: all three double on this day. */
const STEP_2027 = '2027-01-01';
/** Google's footnote: speech is 25 audio tokens a second. */
const SPEECH_TOKENS_PER_SECOND = 25;

export const GEMINI_RATES: readonly GeminiRate[] = [
  { model: 'gemini-3.8-flash', from: LISTED_FROM, textInPerM: 0.75, audioInPerM: 0.75, textOutPerM: 3.75, audioOutPerM: 3.75, audioOutTokensPerSecond: null },
  { model: 'gemini-3.8-flash', from: STEP_2027, textInPerM: 1.5, audioInPerM: 1.5, textOutPerM: 7.5, audioOutPerM: 7.5, audioOutTokensPerSecond: null },
  { model: 'gemini-3.8-flash-tts', from: LISTED_FROM, textInPerM: 0.5, audioInPerM: 0.5, textOutPerM: 9, audioOutPerM: 9, audioOutTokensPerSecond: SPEECH_TOKENS_PER_SECOND },
  { model: 'gemini-3.8-flash-tts', from: STEP_2027, textInPerM: 1, audioInPerM: 1, textOutPerM: 18, audioOutPerM: 18, audioOutTokensPerSecond: SPEECH_TOKENS_PER_SECOND },
  { model: 'gemini-3.8-flash-lite-tts', from: LISTED_FROM, textInPerM: 0.5, audioInPerM: 0.5, textOutPerM: 6, audioOutPerM: 6, audioOutTokensPerSecond: SPEECH_TOKENS_PER_SECOND },
  { model: 'gemini-3.8-flash-lite-tts', from: STEP_2027, textInPerM: 1, audioInPerM: 1, textOutPerM: 12, audioOutPerM: 12, audioOutTokensPerSecond: SPEECH_TOKENS_PER_SECOND },
];

/** The price a model was listed at on a UTC date, or null when no family matches or none had started by then. */
export function rateFor(model: string, usageDate: string): GeminiRate | null {
  const family = longestFamily(model);
  if (family === null) return null;
  let current: GeminiRate | null = null;
  for (const rate of GEMINI_RATES) {
    if (rate.model !== family || rate.from > usageDate) continue;
    if (current === null || rate.from > current.from) current = rate;
  }
  return current;
}

/** A row's estimated dollars at list price, or null when its model has no rate on its day. */
export function costOf(row: PricedRow): number | null {
  const rate = rateFor(row.model, row.usage_date);
  if (rate === null) return null;
  // input_tokens and output_tokens are totals; the audio counts are the part of each that was audio.
  const textIn = Math.max(0, row.input_tokens - row.input_audio_tokens);
  const textOut = Math.max(0, row.output_tokens - row.output_audio_tokens);
  const dollarsPerM =
    textIn * rate.textInPerM +
    row.input_audio_tokens * rate.audioInPerM +
    textOut * rate.textOutPerM +
    row.output_audio_tokens * rate.audioOutPerM;
  return dollarsPerM / TOKENS_PER_PRICED_UNIT;
}

function longestFamily(model: string): string | null {
  let best: string | null = null;
  for (const rate of GEMINI_RATES) {
    if (model.startsWith(rate.model) && (best === null || rate.model.length > best.length)) best = rate.model;
  }
  return best;
}
