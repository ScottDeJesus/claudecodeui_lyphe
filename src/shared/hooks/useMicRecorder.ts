import { useCallback, useEffect, useRef, useState } from 'react';

// Mobile-safe recording: iOS Safari 18.4+ supports webm/opus; older iOS needs mp4.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMime(): string {
  for (const t of MIME_CANDIDATES) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some iOS versions */
    }
  }
  return '';
}

type MicState = 'idle' | 'recording';

type MicClip = { blob: Blob; mimeType: string; durationMs: number };

/**
 * The mic's one recorder: opens the mic on start, answers the clip and its duration on stop, closes the tracks always.
 * Consumed by the chat's useVoiceInput and the companion's useTalkPress.
 *
 * `start()` rejects with a sentence fit to show (denied, no microphone, or the browser's own words). `stop()` answers
 * null when nothing was recording, after `cancel()`, and after an unmount. A recording whose device goes away (the
 * tracks end under it) stops by itself; nobody awaits that clip, so it goes to `onEnded` instead.
 */
export function useMicRecorder(onEnded?: (clip: MicClip) => void): {
  state: MicState;
  start(): Promise<void>;
  stop(): Promise<MicClip | null>;
  cancel(): void;
} {
  // The caller's button reads it: 'recording' from the moment the recorder runs until its stop event lands. A ref cannot
  // stand in, because a ref changing draws nothing.
  const [state, setState] = useState<MicState>('idle');
  // The live recorder. start() and stop() read its own `state` (not React's) so a double tap can't start a second
  // recorder or stop an inactive one.
  const recorderRef = useRef<MediaRecorder | null>(null);
  // The open mic, kept apart from the recorder so an unmount or a cancel can close the tracks even before a recorder exists.
  const streamRef = useRef<MediaStream | null>(null);
  // True while getUserMedia is pending (the permission prompt can sit there for as long as the person likes): a second
  // start() in that window must not open a second mic.
  const startingRef = useRef(false);
  // Set on unmount. Every async path checks it so nothing is drawn, delivered or opened for a component that is gone.
  const unmountedRef = useRef(false);
  // The stop() call waiting for the recorder's stop event, with the instant it was made (the clip ends when the person
  // stopped, not when the encoder finished flushing). Null when nobody asked: a device that ended, a cancel.
  const pendingStopRef = useRef<{ resolve: (clip: MicClip | null) => void; requestedAt: number } | null>(null);
  // Bumped by cancel(): a start() still waiting on getUserMedia finds its number stale and hands the mic straight back.
  const generationRef = useRef(0);
  // The latest onEnded, read when the recorder stops by itself; the recorder outlives the render that started it.
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  });

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      startingRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      pendingStopRef.current?.resolve(null);
      pendingStopRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    startingRef.current = true;
    const generation = generationRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (unmountedRef.current || generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      const chunks: Blob[] = [];
      const startedAt = performance.now();

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      rec.onstop = () => {
        // This recorder's own stream, not whatever streamRef holds now: a new start() may already have replaced it.
        stream.getTracks().forEach((t) => t.stop());
        if (streamRef.current === stream) streamRef.current = null;
        if (recorderRef.current === rec) recorderRef.current = null;
        const pending = pendingStopRef.current;
        pendingStopRef.current = null;
        if (unmountedRef.current) {
          pending?.resolve(null);
          return;
        }
        setState('idle');
        const type = rec.mimeType || 'audio/webm';
        const clip: MicClip = {
          blob: new Blob(chunks, { type }),
          mimeType: type,
          durationMs: Math.round((pending?.requestedAt ?? performance.now()) - startedAt),
        };
        if (pending) pending.resolve(clip);
        else onEndedRef.current?.(clip);
      };

      rec.start();
      setState('recording');
    } catch (e) {
      // A cancelled start's failure is no one's to hear, and its cleanup is already done by cancel().
      if (generation !== generationRef.current) return;
      recorderRef.current = null;
      stopTracks();
      if (unmountedRef.current) return;
      const err = e as { name?: string; message?: string };
      let msg = `Mic error: ${err?.message || e}`;
      if (err?.name === 'NotAllowedError') msg = 'Microphone access denied.';
      else if (err?.name === 'NotFoundError') msg = 'No microphone found.';
      setState('idle');
      throw new Error(msg);
    } finally {
      if (generation === generationRef.current) startingRef.current = false;
    }
  }, []);

  const stop = useCallback((): Promise<MicClip | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      pendingStopRef.current = { resolve, requestedAt: performance.now() };
      rec.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    startingRef.current = false;
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec) {
      // Detached first, so the stop event of a cancelled recording can deliver nothing.
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
    }
    stopTracks();
    pendingStopRef.current?.resolve(null);
    pendingStopRef.current = null;
    setState('idle');
  }, []);

  return { state, start, stop, cancel };
}
