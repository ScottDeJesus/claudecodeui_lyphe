import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, refusalCode, refusalSentence } from '@/shared/api';
import { useMicRecorder } from '@/shared/hooks/useMicRecorder';
import type { TalkPress } from '@/shared/types';

/** The two refusals of a hearing that came to nothing: the server has already written them into her log as a system line. */
const LOGGED_REFUSALS: ReadonlySet<string> = new Set(['COMPANION_SPEECH_REFUSED', 'COMPANION_SPEECH_FAILED']);

/** What the talk button says when the clip could not be sent at all (no answer, or an answer with no sentence). */
const UPLOAD_FAILED = 'Your recording could not be sent.';

type MicClip = { blob: Blob; mimeType: string; durationMs: number };

/**
 * Used by this module's CompanionProvider, which calls it ONCE per page: the one press state that the panel's talk button, the
 * bound key or mouse button (`useTalkBinding`) and her status line all read, and that the voice and avatar features read from
 * the context's `talk`. A second call would be a second mic and a second state.
 *
 * TAP TO TALK. The first `toggle()` opens the mic and records; the second stops it and uploads the clip with its duration
 * through `api.companion.press`. The state runs idle → listening → transcribing → idle. The mic is open only while recording
 * (`listening`): `useMicRecorder` closes its tracks on stop, and a press is the only thing that opens it again.
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
export function useTalkPress(): TalkPress {
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

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /** Sends one clip and settles the count. A refused or failed hearing is the server's line in her log, not an error here. */
  const sendClip = useCallback(async (clip: MicClip) => {
    try {
      const response = await api.companion.press(clip.blob, clip.mimeType, clip.durationMs);
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
    setHearing((count) => count + 1);
    void sendClip(clip);
  }, [sendClip]);

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

  const toggle = useCallback(() => {
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
        if (pressCountRef.current === press) wantedRef.current = false;
        if (aliveRef.current) setError(failure instanceof Error ? failure.message : String(failure));
      }
    });
  }, [finish, inTurn, startMic]);

  const state = mic.state === 'recording' ? 'listening' : hearing > 0 ? 'transcribing' : 'idle';
  // One object per change, so the provider's context value moves only when the press does.
  return useMemo<TalkPress>(() => ({ state, toggle, error }), [state, toggle, error]);
}
