import type { TranscribeAnswer, VoiceAudioUpload } from '@/shared/types.js';

import { transcribeWithGemini } from './gemini-transcribe.js';
import { transcribeLocally } from './local-transcribe.js';

/**
 * Turns one clip into the words spoken, for one account: this box's own speech-to-text service first (`local-transcribe.ts`),
 * Gemini (`gemini-transcribe.ts`) when that gives no words. The service may be down or slow, refuse the clip (a miss) or answer that
 * there are no words in it (silent); the person never hears of either, and Gemini answers exactly as it did before the local service
 * existed, with its own refusals (`no_key`, `refused`, `failed`). A local hit is `ok` whatever the account's Gemini key says, so an
 * account with no key still hears. A silent answer is the service's own and Gemini only a second opinion on it: where that opinion
 * cannot be had (no key, a refused key, a failed call) the empty answer stands, so a press with nothing in it never reads as a
 * refusal about a key the person has no use for. A Gemini refusal reaches the person only when the service gave no answer at all.
 * Read-aloud is not hearing and never comes here. One log line per call says which served it and, for Gemini, why the local
 * service did not. Never throws for an expected failure.
 * Consumed by `voice-provider.ts` (the chat mic when the account's provider is `gemini`) and, through the voice barrel, by the
 * companion's press door.
 */
export async function transcribeSpeech(userId: number, audio: VoiceAudioUpload): Promise<TranscribeAnswer> {
  const startedAt = Date.now();
  const local = await transcribeLocally(userId, audio);
  if (local.kind === 'heard') {
    console.log(`[voice] transcribe local ${audio.bytes.length} B ${Date.now() - startedAt} ms → ok`);
    return { ok: true, text: local.text };
  }

  const answer = await transcribeWithGemini(userId, audio);
  const emptyAnswerStands = local.kind === 'silent' && !answer.ok;
  const outcome = answer.ok ? 'ok' : answer.reason;
  const localNote = local.kind === 'silent' ? 'local heard no words' : `local missed: ${local.why}`;
  const standingNote = emptyAnswerStands ? '; its empty answer stands' : '';
  console.log(`[voice] transcribe gemini fallback ${audio.bytes.length} B ${Date.now() - startedAt} ms → ${outcome} (${localNote}${standingNote})`);
  return emptyAnswerStands ? { ok: true, text: '' } : answer;
}
