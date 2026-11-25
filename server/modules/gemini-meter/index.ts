// createGeminiMeterModule: used by the server entrypoint to mount the meter's two doors at /api/gemini-meter behind
// authenticateToken: the signed-in account's Gemini spend over a window, and its switch per feature.
export { createGeminiMeterModule } from './gemini-meter.module.js';
// recordGeminiCall, geminiFeatureOff, geminiFeatureLabel: used by the voice module's wire (`askGemini`), which counts every
// request it sends to Google, asks the feature's switch before it sends one and names the feature in its off sentence.
export { geminiFeatureLabel, geminiFeatureOff, recordGeminiCall } from './gemini-meter.service.js';
// rateFor: used by the voice wire's usage reading (`gemini-usage-read.ts`) for a model's audio tokens per second, to derive the
// output of a speech answer that carried no usage of Google's own.
export { rateFor } from './gemini-rates.js';
export type { GeminiFeature, GeminiUsage, HeldGeminiKey } from './gemini-meter.service.js';
