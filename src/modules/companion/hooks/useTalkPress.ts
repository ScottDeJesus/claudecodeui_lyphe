import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { NamePressDoor } from '@/modules/companion/hooks/useEars';
import { api, refusalCode, refusalSentence } from '@/shared/api';
import { useMicRecorder } from '@/shared/hooks/useMicRecorder';
import type { TalkPress } from '@/shared/types';

/** The two refusals of a hearing that came to nothing: the server has already written them into her log as a system line. */
const LOGGED_REFUSALS: ReadonlySet<string> = new Set(['COMPANION_SPEECH_REFUSED', 'COMPANION_SPEECH_FAILED']);

/** What the talk button says when the clip could not be sent at all (no answer, or an answer with no sentence). */
const UPLOAD_FAILED = 'Your recording could not be sent.';

type MicClip = { blob: Blob; mimeType: string; durationMs: number };

/** What `useTalkPress` answers: the press consumers read (`TalkPress`), the door her ears open it by, and whether the button's recorder records. */
type TalkPressWithDoor = TalkPress & { byName: NamePressDoor; buttonRecording: boolean };

/**
 * What a press asks of her voice on this page, handed in by CompanionProvider from `useCompanionVoice`. `unlock` opens the
 * page's audio inside the press (a browser plays nothing before a gesture). `cutOff` is asked by the press that opens his mic:
 * it holds her voice while he records, and when she is sounding or a sentence is on its way it stops them all and sends the cut,
 * answering the request's settling (never rejecting); otherwise null. `release` is asked when the recording is over.
 */
type TalkVoice = { unlock: () => void; cutOff: () => Promise<void> | null; release: () => void };

/**
 * Used by this module's CompanionProvider, which calls it ONCE per page: the one press state that the panel's talk button and
 * the bound key or mouse button (`useTalkBinding`) read, and that `useCompanionPresence` reads from the context's `talk` into
 * her status line's state. A second call would be a second mic and a second state.
 *
 * THE NAME DOOR. Her ears (`useEars`) are a second way into this ONE press: `byName.open()` is the opening half of a press (it
 * holds her voice and cuts a sentence on its way, clears the error and shows Listening, but does not `unlock`: there is no gesture,
 * and the page's first touch already armed the ears), and `byName.close(clip)` its closing half (it releases her voice, counts the
 * clip as being heard, and uploads it through `api.companion.press` with `opened = 'name'`, after the owed cut has settled). The
 * ears hold the mic, not this hook, so the recorder below is never started by a name. `state` is `listening` while the button
 * records or a name press is open. `toggle()` while a name press is open is the button ending it: it asks the ears to finish
 * (`finishNamePress`, cause `press`) and counts the clip at the press, so the state goes from Listening to Transcribing with no idle
 * frame between, and the close that follows does not count it again. Her name while his button records is ignored: the ears are
 * told when the button records (`buttonRecording`), and an open that still lands in that gap is refused here.
 * `finishNamePress` is the ears' `finish`, reached through the provider (the ears are called after this hook, since they take its
 * door); it is only called from a press, never while rendering.
 *
 * TAP TO TALK. The first `toggle()` opens the mic and records; the second stops it and uploads the clip with its duration
 * through `api.companion.press`. The state runs idle → listening → transcribing → idle. The mic is open only while recording
 * (`listening`): `useMicRecorder` closes its tracks on stop, and a press is the only thing that opens it again.
 *
 * THE CUT. The press that opens the mic asks her voice first (`voice.cutOff`). It holds her voice for as long as he records
 * (nothing is asked for, so a turn she is still thinking through does not speak into his clip), and if this page's player is
 * sounding or a sentence is queued, the same press stops the player and sends the cut (`POST /api/companion/cut`), shows Cut,
 * and goes on to its own work: the mic never waits on the cut. The press that ends the recording, a mic that never opened and a
 * device that went away each `release` her voice. The clip's upload waits for the cut's request to settle (answered or failed),
 * so the cut is owed to her before the press is pushed.
 *
 * LISTENING WINS. A press while an earlier clip is still being heard starts a new recording at once, and the state reads
 * `listening` until it is stopped; `transcribing` returns if a clip is still out. The server settles presses in arrival order
 * (`companion-press.ts`), so no ordering is kept here.
 *
 * NO PRESS GETS LOST. The press is the user's intent, so it is kept in a ref the moment it lands, and what it asks of the
 * recorder (open the mic, or stop it) waits its turn behind whatever an earlier press asked and has not finished: the browser
 * can take a moment (or a permission prompt, for as long as the person likes) to hand over the mic, and presses that land
 * meanwhile are carried out one after another, in order. The recorder refuses a second `start()` while one is pending, so a
 * press is never handed to it until the one before has finished.
 *
 * WHAT IS AN ERROR HERE is only what failed on the page itself: the mic refused, or the clip could not be sent. A hearing
 * that was refused or failed (no Gemini key, a refused key, a failed call) is the server's system line in her log, so the
 * state just goes back to idle. The error stays until the next press.
 */
export function useTalkPress(voice: TalkVoice, finishNamePress: () => void): TalkPressWithDoor {
  const { unlock, cutOff, release } = voice;
  // How many clips are between the stop press and the server's answer. A count, not a flag: a press that starts a new
  // recording while an earlier clip is out leaves that one in flight, and the state must still return to idle exactly once.
  const [hearing, setHearing] = useState(0);
  // What failed on the page with the last press, shown by the talk button and above the composer; cleared by the next press.
  const [error, setError] = useState<string | null>(null);
  // True from the press that opens the mic until the press that stops it. The press is read from here, never from the
  // recorder's state, which lags a press by the time the browser takes to hand over the mic.
  const wantedRef = useRef(false);
  // How many presses have landed: a mic that fails to open resets the intent only when no press has landed since, because a
  // later press has already chosen what it wants.
  const pressCountRef = useRef(0);
  // The end of the recorder's line of work: every open and stop is chained behind the one before it, so a press made while the
  // mic is still opening (or still stopping) waits instead of being refused by the recorder. Never rejects.
  const turnRef = useRef<Promise<void>>(Promise.resolve());
  // False once the page's provider is gone: an answer that lands then sets nothing.
  const aliveRef = useRef(true);
  // The cut the last press owed, settled or not; a clip's upload waits behind it. Never rejects.
  const cutOwedRef = useRef<Promise<void>>(Promise.resolve());
  // True from the moment her name opens a recording until it closes: with the button's recorder it makes the state `listening`.
  const [nameOpen, setNameOpen] = useState(false);
  // The same fact for the presses and the door, which read it as it stands at the moment, never from a render.
  const nameOpenRef = useRef(false);
  // True once a toggle has counted the open name press's clip as being heard, so the close that follows does not count it again.
  const nameCountedRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Sends one clip and settles the count. A refused or failed hearing is the server's line in her log, not an error here. */
  const sendClip = useCallback(async (clip: MicClip, opened: 'button' | 'name' = 'button') => {
    try {
      await cutOwedRef.current;
      const response = await api.companion.press(clip.blob, clip.mimeType, clip.durationMs, opened);
      if (response.ok) return;
      if (LOGGED_REFUSALS.has((await refusalCode(response)) ?? '')) return;
      if (aliveRef.current) setError((await refusalSentence(response)) ?? UPLOAD_FAILED);
    } catch (failure) {
      console.warn('[Companion] The talk press could not be sent:', failure);
      if (aliveRef.current) setError(UPLOAD_FAILED);
    } finally {
      if (aliveRef.current) setHearing((count) => count - 1);
    }
  }, []);

  // A recording whose device went away stops by itself and nobody awaits its clip: it is the second press, made for him.
  const sendEndedClip = useCallback((clip: MicClip) => {
    wantedRef.current = false;
    release();
    setHearing((count) => count + 1);
    void sendClip(clip);
  }, [sendClip, release]);

  const mic = useMicRecorder(sendEndedClip);
  const { start: startMic, stop: stopMic } = mic;

  /** Runs `work` after everything asked of the recorder before it has finished. */
  const inTurn = useCallback((work: () => Promise<void>) => {
    turnRef.current = turnRef.current.then(work).catch((failure: unknown) => {
      console.warn('[Companion] The talk press could not be carried out:', failure);
    });
  }, []);

  /** The press that stops the recorder: once it is stopped, the clip goes out (nothing waits for the upload; the next press may record at once). */
  const finish = useCallback(() => {
    // Counted at the press, before the recorder answers, so the state goes from listening to transcribing with no idle frame between.
    setHearing((count) => count + 1);
    inTurn(async () => {
      const clip = await stopMic();
      if (clip === null) {
        // Nothing was recording (the mic was refused, or the page left): there is nothing to hear.
        if (aliveRef.current) setHearing((count) => count - 1);
        return;
      }
      void sendClip(clip);
    });
  }, [inTurn, stopMic, sendClip]);

  /** The opening half of every press, the button's and the name's: holds her voice and cuts a sentence on its way; the clip's upload waits for the cut. */
  const holdHerVoice = useCallback(() => {
    const owed = cutOff();
    if (owed !== null) {
      const earlier = cutOwedRef.current;
      cutOwedRef.current = earlier.then(() => owed);
    }
  }, [cutOff]);

  const toggle = useCallback(() => {
    // Inside the press's gesture, before anything else: the browser unlocks the page's audio only here.
    unlock();
    if (nameOpenRef.current && !wantedRef.current) {
      // His button ends a name press: the ears finish it (the clip comes back through `byName.close`), and the clip is counted now.
      if (!nameCountedRef.current) {
        nameCountedRef.current = true;
        setHearing((count) => count + 1);
      }
      finishNamePress();
      return;
    }
    if (wantedRef.current) {
      // The press that ends his recording: her voice may be asked for again.
      release();
    } else {
      holdHerVoice();
    }
    pressCountRef.current += 1;
    const press = pressCountRef.current;
    if (wantedRef.current) {
      wantedRef.current = false;
      finish();
      return;
    }
    wantedRef.current = true;
    setError(null);
    inTurn(async () => {
      try {
        await startMic();
      } catch (failure) {
        // The mic could not be opened: nothing is recording. The next press starts afresh unless a press has landed since,
        // which has already said what it wants.
        if (pressCountRef.current === press) {
          wantedRef.current = false;
          release();
        }
        if (aliveRef.current) setError(failure instanceof Error ? failure.message : String(failure));
      }
    });
  }, [unlock, holdHerVoice, release, finish, finishNamePress, inTurn, startMic]);

  const byName = useMemo<NamePressDoor>(() => ({
    open() {
      // His button records (or is about to): the press is his, and her name is ignored.
      if (wantedRef.current || nameOpenRef.current) return;
      nameOpenRef.current = true;
      setNameOpen(true);
      holdHerVoice();
      setError(null);
    },
    close(clip) {
      // An open that was refused (the button recorded) has no press to close.
      if (!nameOpenRef.current) return;
      nameOpenRef.current = false;
      setNameOpen(false);
      release();
      if (nameCountedRef.current) nameCountedRef.current = false;
      else setHearing((count) => count + 1);
      void sendClip(clip, 'name');
    },
  }), [holdHerVoice, release, sendClip]);

  const buttonRecording = mic.state === 'recording';
  const state = buttonRecording || nameOpen ? 'listening' : hearing > 0 ? 'transcribing' : 'idle';
  // One object per change, so the provider's context value moves only when the press does.
  return useMemo<TalkPressWithDoor>(
    () => ({ state, toggle, error, byName, buttonRecording }),
    [state, toggle, error, byName, buttonRecording],
  );
}
