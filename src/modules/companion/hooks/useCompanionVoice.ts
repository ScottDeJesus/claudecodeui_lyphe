import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createPcmPlayer } from '@/modules/companion/utils/pcmPlayer';
import type { PcmPlayer } from '@/modules/companion/utils/pcmPlayer';
import { createSpeechPull } from '@/modules/companion/utils/speechPull';
import type { CompanionPicture } from '@/shared/companion-types';
import type { CompanionSentenceRef, CompanionVoice } from '@/shared/types';

/** The localStorage key of this device's voice switch: 'off' silences her here, anything else (or nothing) leaves her on. */
const VOICE_SWITCH_KEY = 'companion-voice';

/** How long the status line reads Cut after a press stopped her mid-sentence, in ms. */
const CUT_SHOWN_MS = 900;

function readVoiceSwitch(): boolean {
  try {
    return window.localStorage.getItem(VOICE_SWITCH_KEY) !== 'off';
  } catch {
    // Storage refused the read: on, her default.
    return true;
  }
}

function writeVoiceSwitch(on: boolean): void {
  try {
    window.localStorage.setItem(VOICE_SWITCH_KEY, on ? 'on' : 'off');
  } catch {
    // Storage refused the write: the switch holds for this page's life only.
  }
}

type CompanionVoiceHook = {
  /** This page's voice as her panel draws it: the switch, the sentence sounding, the breath after a cut. */
  voice: CompanionVoice;
  /** Opens or resumes the page's audio inside a gesture, when the switch is on. */
  unlock: () => void;
  /** The press that opens his mic asks this first: holds the pull while he records, and cuts her off if she is sounding (see `createSpeechPull().cutOff`). */
  cutOff: () => Promise<void> | null;
  /** The press that ends his recording: the pull is asked again from what she says next. */
  release: () => void;
  /** Stops what sounds and asks for nothing more of the turn, with the floor kept (Stop, Clear). */
  silence: () => void;
  /** The player's `level()` — its RMS over the last 43 ms, 0..1, and 0 when nothing sounds — for her face's mouth. One function for the page's life. */
  level: () => number;
  /** The player's `progress()` — the sounding sentence's seconds elapsed and, once its body has ended, its length — for the vowel her mouth shapes. One function for the page's life. */
  progress: PcmPlayer['progress'];
};

/**
 * Used by this module's CompanionProvider, once per page: the page's player, the voice switch and the pull that feeds one
 * from the other. Only the page that holds the floor plays, and only while its switch is on (localStorage
 * `companion-voice`, on until turned off); every other page shows her words and makes no speech request.
 *
 * THE PULL asks for each sentence of the turn it is hearing in index order, at most one ahead of the one sounding. Sentence k is
 * asked for as soon as its frame has arrived and nothing is asked for and waiting, which is when k-1 starts (or at once,
 * when the player is idle). A page that takes the floor mid-turn starts with the next sentence whose frame arrives. A 204
 * and a 502 are skipped; a 409 (refused, or not the floor) and a 404 end the pull for the turn. A turn that begins while
 * another is being heard (an alert) is queued and spoken from its first sentence after the heard one's last; only a cut,
 * Stop, Clear, the floor moving or the switch going off empties the queue. A socket reconnect re-seeds the picture and
 * leaves the pull where it was. A page that stops holding the floor, or turns
 * its switch off, stops its player at once. Nothing polls: the pull moves on a frame, an answer, or the player's start.
 *
 * The status the panel reads is ONE state: `speaking` is the sentence the player is sounding, held from its start until the
 * next one starts and null only when the player falls silent; `cut` is true for 900 ms after a press cut her off.
 */
export function useCompanionVoice({ picture, clientId }: { picture: CompanionPicture | null; clientId: string }): CompanionVoiceHook {
  // The page's one player, made once. It opens no audio context until a gesture unlocks it or a sentence arrives.
  const [player] = useState(createPcmPlayer);
  // The sentence the player is sounding, for the log's mark and the status line's Speaking.
  const [speaking, setSpeaking] = useState<CompanionSentenceRef | null>(null);
  // The pull's engine, made once: it keeps its place across renders and across the picture being re-seeded.
  const [engine] = useState(() => createSpeechPull(player, setSpeaking));
  // This device's switch, read from storage at load. Off silences her on this page; the pull does not run.
  const [on, setOnState] = useState(readVoiceSwitch);
  // True for the 900 ms after a cut, for the status line's Cut.
  const [cut, setCut] = useState(false);
  // The switch as the gesture handlers see it, so `unlock` stays one function for the life of the page.
  const onRef = useRef(on);
  // The timer that ends the cut state; one at a time.
  const cutTimerRef = useRef<number | null>(null);

  useEffect(() => {
    onRef.current = on;
  }, [on]);

  // Declared before the arming effect: a commit that moves the floor and the picture together arms against the new picture.
  useEffect(() => {
    if (picture !== null) engine.see(picture);
  }, [engine, picture]);

  const holdsFloor = picture !== null && picture.floor === clientId;
  const active = on && holdsFloor;
  useEffect(() => {
    if (!active) return undefined;
    engine.arm();
    return () => engine.disarm();
  }, [engine, active]);

  useEffect(() => player.onSentence(engine.onSentence), [player, engine]);

  useEffect(() => () => {
    if (cutTimerRef.current !== null) window.clearTimeout(cutTimerRef.current);
  }, []);

  const unlock = useCallback(() => {
    if (!onRef.current) return;
    player.unlock().catch((failure: unknown) => console.warn('[Companion] Her voice could not be unlocked on this page:', failure));
  }, [player]);

  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    writeVoiceSwitch(next);
    // Turning her on is itself a gesture; the effect has not moved `onRef` yet, so the player is asked directly.
    if (next) player.unlock().catch((failure: unknown) => console.warn('[Companion] Her voice could not be unlocked on this page:', failure));
  }, [player]);

  const cutOff = useCallback((): Promise<void> | null => {
    const owed = engine.cutOff();
    if (owed === null) return null;
    setCut(true);
    if (cutTimerRef.current !== null) window.clearTimeout(cutTimerRef.current);
    cutTimerRef.current = window.setTimeout(() => {
      cutTimerRef.current = null;
      setCut(false);
    }, CUT_SHOWN_MS);
    return owed;
  }, [engine]);

  const silence = useCallback(() => engine.silence(), [engine]);
  const release = useCallback(() => engine.release(), [engine]);

  const voice = useMemo<CompanionVoice>(() => ({ on, setOn, speaking, cut }), [on, setOn, speaking, cut]);
  // The player's `level` and `progress` close over the player's own graph and never read `this`, so they are handed out as they stand and keep one identity.
  const { level, progress } = player;
  return useMemo(() => ({ voice, unlock, cutOff, release, silence, level, progress }), [voice, unlock, cutOff, release, silence, level, progress]);
}
