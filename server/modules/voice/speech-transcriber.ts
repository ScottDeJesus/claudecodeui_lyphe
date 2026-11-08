import type {
  HeardAnswer,
  HomeServerTidy,
  VocabularyEntry,
  VoiceAudioUpload,
  VoiceService,
  VoiceTranscribeFailureKind,
} from '@/shared/types.js';

import { redactKey } from './gemini-errors.js';
import { transcribeWithGemini } from './gemini-transcribe.js';
import { resolveHomeServerKey } from './home-server-key.js';
import { cleanTranscript, HAS_WORD_CHARACTER } from './transcript-cleanup.js';
import { homeServerVocabularyLine } from './vocabulary-hints.js';
import { readVocabulary } from './vocabulary.js';
import { readVoiceSettings } from './voice-settings.js';

/**
 * How long the home server has to answer one clip, from connecting to the last byte. Measured on the real box 2026-11-08, its time
 * grows with the audio, and with Clean transcripts on it also cleans the text, which takes longer than hearing it: 61 s of speech took
 * 3.3 s raw and 8.0 s cleaned, 134 s took 6.7 s raw and 14 to 19 s cleaned (two different dictations), and 303 s took 14.6 s raw. So
 * 15 s covers a cleaned dictation of some 100 s of speech (a press is a few seconds and takes one or two), or some five minutes of raw
 * words, and a box that hangs or has left the network costs the person at most this much before Gemini starts. A dictation longer than
 * that never gets its answer in time and is heard by Gemini, which cleans on its own whatever the box was doing: the recorder has no
 * length limit, so this is a stated limit of the wait, not a fault, and the notice then says the box took too long rather than that it
 * did not answer. Gemini keeps its own 60 s call (`gemini-transcribe.ts`): a box that hangs followed by a Gemini that hangs is the
 * longest ordinary wait, 15 s plus 60 s, and a box that refuses the connection or the key hands the clip to Gemini at once.
 */
const HOME_SERVER_WAIT_MS = 15_000;

/**
 * The one short line the person sees when Gemini heard a clip because the home server could not, by why it could not. A
 * `Record` over the kinds, so a new kind breaks the build until it has its words. A box that is down or off the network "didn't
 * answer"; one that was up but gave no complete answer within the wait "took too long", so a long dictation the box was still working
 * on is not taken for a dead box; a refused key and an error say so, because the fix is not the same. An error covers the box's 400 for
 * a clip it cannot read and its 413 for one over 50 MB, which go to Gemini at once like a refused key.
 */
const STAND_IN_NOTICE: Readonly<Record<VoiceTranscribeFailureKind, string>> = {
  unreachable: "Home server didn't answer; Gemini transcribed this",
  timed_out: 'Home server took too long; Gemini transcribed this',
  rejected: 'Home server refused the key; Gemini transcribed this',
  failed: 'Home server had an error; Gemini transcribed this',
};

/** Why the home server did not give a transcript, with its `detail` already free of the account's key. */
type HomeServerFailure = { kind: VoiceTranscribeFailureKind; detail: string };

/** The account's text out of a home server answer, and the words the log line uses for who cleaned it. */
type HomeServerText = { text: string; cleanedNote: string };

/**
 * Builds the one try-then-backup transcriber: the account's home server hears a clip first, and Gemini hears it only when the
 * home server cannot (it is unreachable, refuses the key, answers with an error or gives no complete answer within
 * `HOME_SERVER_WAIT_MS`). An account with no home server set up (no address, or no key) goes straight to Gemini with nothing
 * said, because nothing is down. Gemini is never asked when the home server answered, even with no words.
 *
 * The home server is asked beside the clip to clean the transcript when the account's Clean transcripts switch is on (`clean=1`: um/uh,
 * repeats and false starts out, punctuation fixed) and for its raw words when it is off (`clean=0`), and is told the account's
 * vocabulary in `prompt` for its cleanup to respell sound-alikes by. Its `text` is the transcript. When it says `tidied`, the house does
 * not remove fillers or repeats again and only applies the account's saved misheard-word corrections (`cleanTranscript` without
 * `removeFillers`), except that a text of nothing but fillers is read as no speech (the box answers a bare "Um" as `tidied`). When
 * cleanup was asked and the box says `raw (...)`, its cleanup failed: the house cleans the text itself (`cleanTranscript` with
 * `removeFillers`) and the log names the box's reason. The Gemini door, the backup, cleans its own text once.
 *
 * Answers a `HeardAnswer` and never throws for an expected failure. When Gemini stood in because the home server failed, `standIn`
 * is the line to show. When both failed, the sentence names both and holds no key, and its `reason` is the backup's, so a
 * missing or refused Gemini key still points at Settings. One log line per clip says who heard it (`heard by ...`), after the
 * Gemini door's own line when it ran; nothing in them is a key or an address.
 *
 * Consumed by `voice.module.ts`, which builds the one instance that the chat mic's provider (`voice-provider.ts`) and, through the
 * voice barrel as `transcribeSpeech`, the companion's press door both call, so the two hear the same way.
 */
export function createSpeechTranscriber(voiceService: VoiceService) {
  return async function transcribeSpeech(userId: number, audio: VoiceAudioUpload): Promise<HeardAnswer> {
    const settings = readVoiceSettings(userId);
    const address = settings.homeServer.address;
    const key = resolveHomeServerKey(userId);

    if (address === null || key === null) {
      const backup = await transcribeWithGemini(userId, audio);
      console.log(`[voice] heard by ${backup.ok ? 'Gemini' : 'nobody'}: the home server is not set up (${address === null ? 'no address' : 'no key'})`);
      return backup.ok ? { ok: true, text: backup.text, standIn: null } : backup;
    }

    // Read once: the list the box is told is the list that corrects its answer, whatever is saved while it works.
    const vocabulary = readVocabulary(userId);
    const startedAt = Date.now();
    const home = await voiceService.transcribe({
      audio,
      baseUrl: address,
      apiKey: key,
      waitMs: HOME_SERVER_WAIT_MS,
      clean: settings.cleanTranscripts,
      vocabularyLine: homeServerVocabularyLine(vocabulary),
    });
    const homeElapsedMs = Date.now() - startedAt;

    // The service has already taken the key out of the box's own words (a failure's detail, its reason for not tidying); `redactKey` is the
    // second layer, and the one that also strips a Google-shaped key.
    if (home.ok) {
      const heard = homeServerText(home, settings.cleanTranscripts, vocabulary);
      console.log(`[voice] heard by the home server: ${audio.bytes.length} B in ${homeElapsedMs} ms, ${redactKey(heard.cleanedNote, key)}`);
      return { ok: true, text: heard.text, standIn: null };
    }

    const failure: HomeServerFailure = { kind: home.kind, detail: redactKey(home.detail, key) };
    const backup = await transcribeWithGemini(userId, audio);
    const homeStory = `the home server failed after ${homeElapsedMs} ms: ${failure.detail}`;

    if (backup.ok) {
      console.log(`[voice] heard by Gemini: ${homeStory}`);
      return { ok: true, text: backup.text, standIn: STAND_IN_NOTICE[failure.kind] };
    }
    console.log(`[voice] heard by nobody: ${homeStory}; Gemini ${backup.reason}`);
    return { ok: false, reason: backup.reason, sentence: bothFailedSentence(failure, backup.sentence) };
  };
}

/**
 * The account's text out of the home server's answer. A text with no words is a clip with no speech and nothing to clean (the box
 * itself says "raw (clean=0)" for one, so its `tidy` means nothing then). With cleanup asked, so is a text of nothing but fillers: the
 * real box does not take a lone "Um" out, it answers it `tidied`, and the house reads it as the empty press its own cleanup has always
 * made of it, not as a turn of his. Otherwise the box's text is the transcript, and the one question is whether the house still has
 * to take the fillers out: only when cleanup was asked and the box did not do it. The account's misheard-word corrections apply to
 * every transcript, whoever cleaned it.
 */
function homeServerText(home: { text: string; tidy: HomeServerTidy }, cleanAsked: boolean, vocabulary: readonly VocabularyEntry[]): HomeServerText {
  const words = heardWords(home.text);
  if (words === '') return { text: '', cleanedNote: 'no speech' };
  if (!cleanAsked) return { text: cleanTranscript(words, { removeFillers: false, vocabulary }), cleanedNote: 'raw as asked (Clean transcripts is off)' };
  if (hasOnlyFillers(words)) return { text: '', cleanedNote: 'no speech (only fillers)' };
  if (home.tidy.tidied) return { text: cleanTranscript(words, { removeFillers: false, vocabulary }), cleanedNote: 'tidied by the home server' };
  return {
    text: cleanTranscript(words, { removeFillers: true, vocabulary }),
    cleanedNote: `not tidied by the home server (${home.tidy.reason}), so cleaned here`,
  };
}

/** Whether the words are nothing but fillers ("Um", "Uh, um."): the house's filler step leaves nothing of such a text. Asked with no vocabulary, so that only the fillers decide. */
function hasOnlyFillers(words: string): boolean {
  return cleanTranscript(words, { removeFillers: true, vocabulary: [] }) === '';
}

/**
 * The box's words as the Gemini door gives its own: trimmed, and `''` when nothing in them is a letter or a digit. A lone "." or only
 * whitespace is a clip with no speech, not a line to hand on: with Clean transcripts off `cleanTranscript` would pass either through
 * as said, to the composer and to Kaylee, where a name press would be pushed as a call by name for nothing said.
 */
function heardWords(text: string): string {
  const trimmed = text.trim();
  return HAS_WORD_CHARACTER.test(trimmed) ? trimmed : '';
}

/** The sentence for a clip neither transcriber heard: both are named, the home server's reason first, then the backup's own sentence. */
function bothFailedSentence(failure: HomeServerFailure, backupSentence: string): string {
  return `The home server and Gemini both failed to transcribe this. Home server: ${failure.detail}. ${backupSentence}`;
}
