// voiceRoutes: used by the server entrypoint to mount authenticated STT/TTS endpoints and the account's voice settings.
export { voiceRoutes } from './voice.module.js';
// transcribeSpeech: used by the companion module's press door to turn the operator's recorded clip into words. It always
// hears through Gemini, whatever the chat composer's provider picker says, and is not counted against any Gemini budget.
export { transcribeWithGemini as transcribeSpeech } from './gemini-transcribe.js';
// synthesizeSentence: used by the companion module's speech door (`companion-speech.ts`, behind `GET /api/companion/speech/:turnId/:index`)
// to speak one of her sentences in the account's Gemini voice, streamed as PCM. Not counted against any Gemini budget.
export { synthesizeSentence } from './gemini-speech.js';
// readVoiceSettings: used by the companion module's wiring (`companion-account.ts`) to read the account's sound-tag list fresh, at the start
// of each turn (the parse that strips her sentences) and at each push (the register that teaches her the sounds).
export { readVoiceSettings } from './voice-settings.js';
// geminiKeyStatus: used by the companion's `read_settings` (`eyes/house-reads.ts`) to say whose Gemini key the voice is using ("a key of yours", "the house's
// key", "no key"). The companion reads the `source` alone: the key and its last characters never leave the voice module's settings routes.
export { geminiKeyStatus } from './gemini-key.js';
// DEFAULT_SOUND_TAGS: the ten sounds an account holds until it saves its own list; used by the companion's sentence-stream probe
// (`.verify/companion-wire-contract.mjs`) to prove the parse against the shipped set. The live readers take the list from readVoiceSettings.
export { DEFAULT_SOUND_TAGS } from './voice-settings.js';
// TranscribeAnswer: the type of transcribeSpeech's answer, read by the companion's press door to tell a refusal from a failure.
export type { TranscribeAnswer } from '@/shared/types.js';
// SpeechAnswer: the type of synthesizeSentence's answer, read by the companion's speech route to tell a refusal from a stream.
export type { SpeechAnswer } from '@/shared/types.js';
