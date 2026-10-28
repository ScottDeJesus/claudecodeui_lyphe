import { useCallback, useEffect, useRef, useState } from 'react';

import { currentVoiceProvider } from '@/modules/chat/hooks/useVoiceProvider';
import { refusalSentence, transcribeVoice } from '@/shared/api';
import { useMicRecorder } from '@/shared/hooks/useMicRecorder';
import type { VoiceInputState } from '@/shared/types';
import { recordingFileName } from '@/shared/utils';

/**
 * Push-to-talk dictation. Records the mic (useMicRecorder), transcribes it through the account's provider as useVoiceProvider
 * last read it, at the moment the clip is sent (the OpenAI-compatible backend, posted to the browser's own endpoint or the
 * Express proxy, or Gemini through the proxy on the server's key), and returns the transcript through onTranscript. A refusal
 * from Gemini (no key, a refused key) is handed to onError as the server's own sentence.
 */
export function useVoiceInput(
  onTranscript: (text: string, send?: boolean) => void,
  onError?: (msg: string) => void,
) {
  // True from the moment a clip is handed to the speech service until its answer lands. The recorder is idle for that
  // whole stretch, so the button's spinner can't be derived from the recorder's own state.
  const [transcribing, setTranscribing] = useState(false);
  // Set on unmount. A transcription is awaited across the network, so every step after an await asks it before
  // touching state or calling the caller's handlers; the recorder keeps its own copy for its half.
  const unmountedRef = useRef(false);
  // The latest callbacks, read when a transcript or an error arrives: a clip outlives the render that started its
  // recording, and this keeps `start` and `stop` the same functions across renders.
  const handlersRef = useRef({ onTranscript, onError });
  useEffect(() => {
    handlersRef.current = { onTranscript, onError };
  });


  // The transcription half must stay quiet once the component is gone; the recorder guards its own half.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const transcribe = useCallback(async (clip: { blob: Blob; mimeType: string }, shouldSend: boolean) => {
    if (unmountedRef.current) return;
    const { blob, mimeType } = clip;
    if (blob.size < 800) {
      handlersRef.current.onError?.('Recording too short');
      return;
    }
    setTranscribing(true);
    try {
      // Read now, not when the recording began: the picker may have moved in between.
      const clipProvider = currentVoiceProvider();
      const res = await transcribeVoice(blob, recordingFileName(mimeType), clipProvider);
      if (!res.ok) {
        // Gemini's refusals are sentences for the person ("No Gemini key: set one in Settings → Voice"), so they are
        // shown as they came. The OpenAI-compatible branch keeps its status words.
        const sentence = clipProvider === 'gemini' ? await refusalSentence(res) : null;
        if (sentence) {
          if (!unmountedRef.current) handlersRef.current.onError?.(sentence);
          return;
        }
        throw new Error(`transcribe ${res.status}`);
      }
      const data = await res.json();
      if (unmountedRef.current) return;
      const text = String(data?.text || '').trim();
      if (text) handlersRef.current.onTranscript(text, shouldSend);
      else handlersRef.current.onError?.('No speech detected');
    } catch (e) {
      if (!unmountedRef.current) {
        handlersRef.current.onError?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (!unmountedRef.current) setTranscribing(false);
    }
  }, []);

  // A recording that ended by itself (the device went away) is transcribed as a plain stop: nothing asked it to send.
  const transcribeEndedClip = useCallback((clip: { blob: Blob; mimeType: string }) => {
    void transcribe(clip, false);
  }, [transcribe]);

  const mic = useMicRecorder(transcribeEndedClip);
  const { start: startMic, stop: stopMic } = mic;

  const start = useCallback(async () => {
    try {
      await startMic();
    } catch (e) {
      handlersRef.current.onError?.(e instanceof Error ? e.message : String(e));
    }
  }, [startMic]);

  // Stop recording. Pass { send: true } to auto-send the transcript once it's ready.
  // The recorder answers null when it was not recording, so a double tap, or the mic
  // and Send buttons both firing, transcribes one clip and the second call is dropped.
  const stop = useCallback((opts?: { send?: boolean }) => {
    const shouldSend = opts?.send ?? false;
    void stopMic().then((clip) => {
      if (clip) void transcribe(clip, shouldSend);
    });
  }, [stopMic, transcribe]);

  const state: VoiceInputState = transcribing ? 'transcribing' : mic.state;

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') start();
  }, [state, start, stop]);

  return { state, toggle, stop };
}
