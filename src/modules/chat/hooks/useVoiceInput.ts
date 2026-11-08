import { useCallback, useEffect, useRef, useState } from 'react';

import { refusalSentence, transcribeVoice } from '@/shared/api';
import { useMicRecorder } from '@/shared/hooks/useMicRecorder';
import type { VoiceInputState } from '@/shared/types';
import { recordingFileName } from '@/shared/utils';

/**
 * Push-to-talk dictation. Records the mic (useMicRecorder), sends the clip to the server (`transcribeVoice`), which hears it on the
 * account's home server first and on Gemini only when the home server cannot, and returns the transcript through onTranscript. The
 * transcript is the account's cleaned one (fillers out, house words corrected), whichever transcriber heard it, and the account's
 * read-aloud provider has no say in who transcribes. When Gemini stood in because the home server could not, the transcript is
 * delivered and the server's one short line saying so ("Home server didn't answer; Gemini transcribed this") goes to onError, where
 * the mic's errors show. A clip neither could hear, or a refusal (no Gemini key, a refused key), is handed to onError as the
 * server's own sentence, which names both transcribers.
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
      const res = await transcribeVoice(blob, recordingFileName(mimeType));
      if (!res.ok) {
        // The server's refusals are sentences for the person ("No Gemini key: set one in Settings → Voice", or the one that
        // names the home server and Gemini both), so they are shown as they came. An answer with none keeps its status words.
        const sentence = await refusalSentence(res);
        if (sentence) {
          if (!unmountedRef.current) handlersRef.current.onError?.(sentence);
          return;
        }
        throw new Error(`transcribe ${res.status}`);
      }
      const data = await res.json();
      if (unmountedRef.current) return;
      const text = String(data?.text || '').trim();
      // Present only when Gemini heard the clip because the home server could not: the person is told, so he knows the box is down.
      const notice = typeof data?.notice === 'string' ? data.notice.trim() : '';
      if (text) {
        handlersRef.current.onTranscript(text, shouldSend);
        if (notice) handlersRef.current.onError?.(notice);
      } else {
        handlersRef.current.onError?.(notice ? `No speech detected. ${notice}` : 'No speech detected');
      }
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
