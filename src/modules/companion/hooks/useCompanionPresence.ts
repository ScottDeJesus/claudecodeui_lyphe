import { useMemo } from 'react';

import { useCompanion } from '@/modules/companion/context/CompanionContext';
import type { CompanionActivity, CompanionPhase } from '@/shared/companion-types';
import type { CompanionPresence, CompanionPresenceState, TalkPressState } from '@/shared/types';

/** The phases this build can name; a phase outside them comes from a newer server (the reducer admits any text) and reads as `thinking`. */
const KNOWN_PHASES: ReadonlySet<string> = new Set<CompanionPhase>(['idle', 'thinking', 'reading_session', 'reading_code', 'drafting', 'walking']);

/**
 * Used by this file's hook, and by `.verify/lib/companion-kit.mjs`, `talk-kit.mjs` and `voice-kit.mjs`, which mount her panel
 * view on fixtures where no provider stands: the presence of three things that have no other meeting place — her
 * server-held activity, this page's talk press (`talkState`) and this page's player (`speaking`: it is sounding a sentence;
 * `cut`: the breath after a press stopped it). PURE, so the hook and the kits resolve the state by the same rule.
 *
 * THE ORDER IS FIXED: cut > listening > transcribing > speaking > her activity's phase. The page speaks before her because
 * it is what he just did or is hearing: his open mic must show even while she is mid-sentence, and the cut is the one word
 * for the instant her voice stopped. Her activity holds one phase at a time, so the order among its phases (reading_code >
 * reading_session > drafting > walking > thinking > idle) never has two to choose between. A null activity (the picture
 * still loading) is idle. `session`, `files` and `walk` always come from the activity, whatever the state.
 */
export function presenceOf(activity: CompanionActivity | null, talkState: TalkPressState, cut: boolean, speaking: boolean): CompanionPresence {
  return {
    state: presenceStateOf(activity, talkState, cut, speaking),
    session: activity?.session ?? null,
    files: activity?.files ?? null,
    walk: activity?.walk ?? null,
  };
}

function presenceStateOf(activity: CompanionActivity | null, talkState: TalkPressState, cut: boolean, speaking: boolean): CompanionPresenceState {
  if (cut) return 'cut';
  // The press is in exactly one of listening and transcribing; 'listening' wins when a new recording started over a clip still out (useTalkPress).
  if (talkState !== 'idle') return talkState;
  if (speaking) return 'speaking';
  if (activity === null) return 'idle';
  return KNOWN_PHASES.has(activity.phase) ? activity.phase : 'thinking';
}

/**
 * Used by this module's CompanionPanel, which hands the result to the header's status line. THE ONE READER of Kaylee's
 * activity (`picture.activity`), the page's talk press (`talk.state`) and the page's player (`voice.speaking`, `voice.cut`):
 * whatever draws what she is doing reads these three from here, so no two consumers can resolve them differently.
 *
 * NOT THE PROCESS. Asleep, waking, failed and a picture still loading are not presence states (the union has no word for
 * them), so the status line reads `picture.process` itself for those four words, and `state` stays what her activity says
 * (idle at rest). A consumer that must tell them from idle reads the process beside the presence, as the header does.
 *
 * Not a state of its own: it derives from the provider's. The activity is keyed by its VALUE, not its object: the server
 * sends a fresh object with every `companion_activity` frame (repeats included) and a re-seed replaces the whole picture, and
 * a presence minted for words that did not change would restart whatever a consumer holds on it.
 */
export function useCompanionPresence(): CompanionPresence {
  const { picture, talk, voice } = useCompanion();
  const activity = picture?.activity ?? null;
  const activityKey = JSON.stringify(activity);
  const talkState = talk.state;
  const { cut } = voice;
  // The sentence's place changes with every sentence; the presence only needs to know whether one sounds.
  const speaking = voice.speaking !== null;
  // `activity` is read inside but keyed by `activityKey`: the same words are the same presence.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => presenceOf(activity, talkState, cut, speaking), [activityKey, talkState, cut, speaking]);
}
