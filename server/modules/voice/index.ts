// voiceRoutes: used by the server entrypoint to mount authenticated STT/TTS endpoints and the account's voice settings.
export { voiceRoutes } from './voice.module.js';
// transcribeSpeech: used by the companion module's press door to turn the operator's recorded clip into words. It is the one
// try-then-backup transcriber the chat mic uses too (the account's home server first, Gemini the backup), whatever the chat
// composer's provider picker says; Gemini's calls are not counted against any Gemini budget.
export { transcribeSpeech } from './voice.module.js';
// synthesizeSentence: used by the companion module's speech door (`companion-speech.ts`, behind `GET /api/companion/speech/:turnId/:index`)
// to speak one of her sentences in the account's Gemini voice, streamed as PCM. Not counted against any Gemini budget.
export { synthesizeSentence } from './gemini-speech.js';
// readVoiceSettings: used by the companion module's wiring (`companion-account.ts`) to read the account's sound-tag list fresh, at the start
// of each turn (the parse that strips her sentences) and at each push (the register that teaches her the sounds), and by its `read_settings`
// eyes (`eyes/house-reads.ts`) to say every voice setting, `cleanTranscripts` included, as a line.
export { readVoiceSettings } from './voice-settings.js';
// geminiKeyStatus: used by the companion's `read_settings` (`eyes/house-reads.ts`) to say whose Gemini key the voice is using ("a key of yours", "the house's
// key", "no key"). The companion reads the `source` alone: the key and its last characters never leave the voice module's settings routes.
export { geminiKeyStatus } from './gemini-key.js';
// homeServerKeyStatus: used by the companion's `read_settings` (`eyes/house-reads.ts`) to say whether the home server that transcribes first is set up
// (an address and a key). The companion reads the `source` alone, as it does the Gemini key's.
export { homeServerKeyStatus } from './home-server-key.js';
// DEFAULT_SOUND_TAGS: the ten sounds an account holds until it saves its own list; used by the companion's sentence-stream probe
// (`.verify/companion-wire-contract.mjs`) to prove the parse against the shipped set. The live readers take the list from readVoiceSettings.
export { DEFAULT_SOUND_TAGS } from './voice-settings.js';
// HeardAnswer: the type of transcribeSpeech's answer, read by the companion's press door to tell a refusal from a failure and to see when Gemini stood in.
export type { HeardAnswer } from '@/shared/types.js';
// SpeechAnswer: the type of synthesizeSentence's answer, read by the companion's speech route to tell a refusal from a stream.
export type { SpeechAnswer } from '@/shared/types.js';
