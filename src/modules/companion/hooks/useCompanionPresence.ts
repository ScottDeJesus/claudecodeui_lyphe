import { useMemo } from 'react';

import { useCompanion } from '@/modules/companion/context/CompanionContext';
import type { CompanionPhase, CompanionPicture } from '@/shared/companion-types';
import type { CompanionPresence, CompanionPresenceState, TalkPressState } from '@/shared/types';

/** The phases this build can name; a phase outside them comes from a newer server (the reducer admits any text) and reads as `thinking`. */
const KNOWN_PHASES: ReadonlySet<string> = new Set<CompanionPhase>(['idle', 'thinking', 'reading_session', 'reading_code', 'drafting', 'walking']);

/**
 * Used by this file's hook, and by `.verify/lib/companion-kit.mjs`, `talk-kit.mjs` and `voice-kit.mjs`, which mount her panel
 * view on fixtures where no provider stands (each hands in its fixture's picture, null for the loading one): the presence of
 * four things that have no other meeting place — her server-held picture (her process and her activity), this page's talk
 * press (`talkState`) and this page's player (`speaking`: it is sounding a sentence; `cut`: the breath after a press stopped
 * it). PURE, so the hook and the kits resolve the state by the same rule.
 *
 * THE ORDER IS FIXED: cut > listening > transcribing > speaking > loading (no picture yet) > failed > asleep > waking > her
 * activity's phase. The page speaks before her because it is what he just did or is hearing: his open mic must show even
 * while she is mid-sentence or her process is down, and the cut is the one word for the instant her voice stopped. Her
 * process comes before her activity because a Kaylee who cannot answer must never read as ready: a failed login or a
 * missing CLI is not good news to hide behind an idle face. Her activity holds one phase at a time, so the order among its
 * phases (reading_code > reading_session > drafting > walking > thinking > idle) never has two to choose between; a phase
 * this build does not know reads as thinking. `session`, `files` and `walk` always come from the activity, whatever the state.
 */
export function presenceOf(
  picture: Pick<CompanionPicture, 'activity' | 'process'> | null,
  talkState: TalkPressState,
  cut: boolean,
  speaking: boolean,
): CompanionPresence {
  const activity = picture?.activity;
  return {
    state: presenceStateOf(picture, talkState, cut, speaking),
    session: activity?.session ?? null,
    files: activity?.files ?? null,
    walk: activity?.walk ?? null,
  };
}

function presenceStateOf(
  picture: Pick<CompanionPicture, 'activity' | 'process'> | null,
  talkState: TalkPressState,
  cut: boolean,
  speaking: boolean,
): CompanionPresenceState {
  if (cut) return 'cut';
  // The press is in exactly one of listening and transcribing; 'listening' wins when a new recording started over a clip still out (useTalkPress).
  if (talkState !== 'idle') return talkState;
  if (speaking) return 'speaking';
  if (picture === null) return 'loading';
  const { state: processState } = picture.process;
  if (processState === 'failed' || processState === 'asleep' || processState === 'waking') return processState;
  const { phase } = picture.activity;
  return KNOWN_PHASES.has(phase) ? phase : 'thinking';
}

/**
 * Used by this module's CompanionPanel, which hands the result to the header's status line, and by CompanionFab, which draws it
 * as the button's face and label: both read one state, so the line and the face change in the same frame. THE ONE RESOLVER of
 * Kaylee's picture (`picture.process`, `picture.activity`), the page's talk press (`talk.state`) and the page's player
 * (`voice.speaking`, `voice.cut`) into a state: whatever draws what she is doing reads that state from here, so no two
 * consumers can resolve them differently. A consumer may still read one source for its own part (the talk button reads
 * `talk.state`, the log reads `voice.speaking`, the header's controls read the picture).
 *
 * HER PROCESS IS PART OF THE STATE. Loading, failed, asleep and waking are presence states: the status line takes its
 * words from the state alone, and the button says she is stopped, asleep, waking or loading instead of ready.
 *
 * Not a state of its own: it derives from the provider's. The picture is keyed by what `presenceOf` reads of it, the
 * process's state and the activity's VALUE, not its object: the server sends a fresh object with every `companion_activity`
 * frame (repeats included) and a re-seed replaces the whole picture, and a presence minted for words that did not change
 * would restart whatever a consumer holds on it.
 */
export function useCompanionPresence(): CompanionPresence {
  const { picture, talk, voice } = useCompanion();
  const activityKey = JSON.stringify(picture?.activity ?? null);
  // Null while the picture loads, so the first read of it is a change of key too.
  const processState = picture?.process.state ?? null;
  const talkState = talk.state;
  const { cut } = voice;
  // The sentence's place changes with every sentence; the presence only needs to know whether one sounds.
  const speaking = voice.speaking !== null;
  // `picture` is read inside but keyed by `activityKey` and `processState`: the same words are the same presence.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => presenceOf(picture, talkState, cut, speaking), [activityKey, processState, talkState, cut, speaking]);
}
