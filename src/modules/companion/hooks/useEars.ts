import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { playEarcon } from '@/modules/companion/utils/earcons';
import { encodeWav } from '@/modules/companion/utils/earsAudio';
import { ensurePageAudioContext, heldAudioContext } from '@/modules/companion/utils/earsContext';
import { createEarsEngine } from '@/modules/companion/utils/earsEngine';
import type { EarsEngine } from '@/modules/companion/utils/earsEngine';
import type { EarsFromWorker } from '@/modules/companion/utils/earsProtocol';
import { canUseMicrophone, earsStateOf, isEarsSwitchChange, microphoneSentence, NO_MICROPHONE, readEarsSwitch, writeEarsSwitch } from '@/modules/companion/utils/earsState';
import { api } from '@/shared/api';
import { getStoredAuthToken } from '@/shared/authToken';
import type { CompanionPicture } from '@/shared/companion-types';
import type { CompanionEars } from '@/shared/types';

/** Her name until the picture says otherwise: the server's default, and what the worker listens for before a rename. */
const DEFAULT_NAME = 'Kaylee';

/** The microphone the ears open: the browser's own cleanup of the room, as the talk button's recorder asks for it. */
const MICROPHONE = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } } as const;

/** The name door the press gives the ears: `open` when her name opened a recording, `close` with its clip. */
export type NamePressDoor = { open(): void; close(clip: { blob: Blob; mimeType: 'audio/wav'; durationMs: number }): void };

/**
 * Used once by CompanionProvider: the page's ears, armed under the four conditions, and `finish`, which the press calls when
 * his button ends a name press. Her ears are a second way into the provider's ONE press (`door`), so every page that mounts the
 * provider has them, and nothing is built into the panel.
 *
 * ARMED ONLY WHEN ALL FOUR HOLD: the switch is on for this device (`companion-ears` in localStorage); this page holds the floor
 * (two pages hearing one "Kaylee" would push two presses); the page has been touched (its first `pointerdown` or `keydown`, or the
 * switch's own press), because an AudioContext stays suspended until then; and the page is a secure context with a microphone.
 * Arming and disarming happen on events and nothing polls: the switch, the `companion_*` frame that moves the floor (it reaches
 * `picture`), the first touch, `devicechange`, a track's `ended`, and the switch changed from another tab (the `storage` event).
 *
 * THE ORDER. The models load first; the mic opens only once they are ready (`engine.arm()` resolved), so it is never open while
 * nothing can listen. A disarm closes the mic at once. The engine, with its models, is kept while the switch is on, so a floor that
 * moves back re-arms in a moment; it ends when the switch goes off, or when she is renamed (the worker listens for one name; the new
 * engine loads from the browser's cache of the immutable files). A name press still open when an engine goes is closed by the
 * worker (`gone`) and its clip is sent: the engine ends after that close. The press door does not hand the floor back for that clip
 * (a name press takes it only while no page holds it), so a floor that moved away stays where it moved.
 *
 * THE TONES play on the ears' own AudioContext (`earcons.ts`), never through her player.
 */
export function useEars(input: { picture: CompanionPicture | null; clientId: string; herVoiceSounding: boolean; buttonRecording: boolean; door: NamePressDoor }): { ears: CompanionEars; finish(): void } {
  const { picture, clientId, herVoiceSounding, buttonRecording, door } = input;
  // This device's switch, read from storage at load: the operator's own control, per device, off until he turns it on.
  const [on, setOnState] = useState(readEarsSwitch);
  // The audio context the capture and the tones use. Made at the switch's press or the page's first touch, so a context that exists
  // IS the page having been touched (before one it would stay suspended). The page keeps it (`earsContext.ts`), so a provider that
  // mounts later in the same document (the workspace and the station each have one) starts with the touch the page already had.
  const [audioContext, setAudioContext] = useState<AudioContext | null>(heldAudioContext);
  // The engine whose models are loaded and whose capture holds the mic, null while none does (loading, and from any disarm). Held as
  // the engine, not a flag: a new engine (a rename) is not listening in the very render that makes it, so the row says "Getting her
  // ears ready" there and never "Listening for <new name>" while the old ears still hear.
  const [listeningEngine, setListeningEngine] = useState<EarsEngine | null>(null);
  // The sentence of what went wrong (the mic refused or went away, the worker failed), which the row shows as `unavailable`. Cleared
  // on every event that arms again, and a page that found no microphone clears it on `devicechange`.
  const [failure, setFailure] = useState<string | null>(null);
  // Whether a name press is open, for the row's "Listening". The press itself is the provider's; this only tells the row.
  const [hearing, setHearing] = useState(false);
  // The same fact for the worker's messages, which are not React events and must read it as it stands.
  const pressOpenRef = useRef(false);

  // The press door as the provider gave it last, read by the worker's messages without making the engine depend on it.
  const doorRef = useRef(door);
  // Engines that were let go with a name press open: each ends at the `closed` (or `failed`) that settles the press.
  const retiringRef = useRef(new Set<EarsEngine>());

  useEffect(() => {
    doorRef.current = door;
  }, [door]);

  const name = picture?.settings.name ?? DEFAULT_NAME;
  const capable = canUseMicrophone();
  const holdsFloor = picture !== null && picture.floor === clientId;

  /** Takes the page's audio context inside a gesture (the switch's press or the first touch): the one the page already made, else a new one. */
  const ensureAudioContext = useCallback(() => {
    if (!canUseMicrophone()) return;
    try {
      const context = ensurePageAudioContext();
      setAudioContext(context);
      if (context.state === 'suspended') context.resume().catch((error: unknown) => console.warn('[Companion] Her ears could not wake the page\'s audio:', error));
    } catch (error) {
      console.warn('[Companion] Her ears could not make an audio context:', error);
      setFailure(microphoneSentence(error));
    }
  }, []);

  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    writeEarsSwitch(next);
    // The switch's own press is the touch the page's audio waits for.
    if (next) ensureAudioContext();
  }, [ensureAudioContext]);

  // The switch is the device's, kept in storage, so another tab of this browser can turn it off (or on). That tab's write reaches
  // this one as a `storage` event, and the ears follow it: a switch that says off never leaves a microphone open here.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (isEarsSwitchChange(event)) setOnState(readEarsSwitch());
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, []);

  // The first touch, for a page that loaded with the switch on: one listener on each of the two events, gone at the first.
  useEffect(() => {
    if (!on || !capable || audioContext !== null) return undefined;
    const touch = () => ensureAudioContext();
    window.addEventListener('pointerdown', touch, { capture: true, once: true });
    window.addEventListener('keydown', touch, { capture: true, once: true });
    return () => {
      window.removeEventListener('pointerdown', touch, { capture: true });
      window.removeEventListener('keydown', touch, { capture: true });
    };
  }, [on, capable, audioContext, ensureAudioContext]);

  /** Plays one cue; an audio context that cannot (closed by the browser) costs the cue, never the press. */
  const sound = useCallback((context: AudioContext, kind: 'opened' | 'closed') => {
    try {
      playEarcon(context, kind);
    } catch (error) {
      console.warn(`[Companion] Her ears could not play the ${kind} tone:`, error);
    }
  }, []);

  /** Closes the open name press at the door with its clip, however it closed: the falling tone, one console line, the clip. */
  const closePress = useCallback((context: AudioContext, cause: string, wav: ArrayBuffer, durationMs: number) => {
    pressOpenRef.current = false;
    setHearing(false);
    console.log(`[Companion] Her ears closed the recording: ${cause}, ${durationMs} ms`);
    sound(context, 'closed');
    doorRef.current.close({ blob: new Blob([wav], { type: 'audio/wav' }), mimeType: 'audio/wav', durationMs });
  }, [sound]);

  /** Everything the worker says, from the engine `from` made on `context`. */
  const onWorkerMessage = useCallback((from: EarsEngine, context: AudioContext, message: EarsFromWorker) => {
    if (message.kind === 'opened') {
      if (pressOpenRef.current) return;
      pressOpenRef.current = true;
      setHearing(true);
      console.log('[Companion] Her ears opened a recording');
      sound(context, 'opened');
      doorRef.current.open();
      return;
    }
    if (message.kind !== 'closed' && message.kind !== 'failed') return;
    const retiring = retiringRef.current.has(from);
    if (message.kind === 'failed' && !retiring) setFailure(message.sentence);
    if (pressOpenRef.current) {
      // A worker that failed posts no `closed`: the press is closed here with an empty clip, so it never waits for ever.
      if (message.kind === 'closed') closePress(context, message.cause, message.wav, message.durationMs);
      else closePress(context, 'failed', encodeWav(new Int16Array(0)), 0);
    }
    if (retiring) {
      retiringRef.current.delete(from);
      from.end();
    }
  }, [sound, closePress]);

  // The engine for this switch, context and name: made while the switch is on and the page has been touched. Making it starts no
  // worker (the first `arm` does), so a render that makes one and drops it costs nothing.
  const engine = useMemo(() => {
    if (!on || audioContext === null) return null;
    const made: EarsEngine = createEarsEngine({
      context: audioContext,
      name,
      filesBase: api.companion.earsFilesBase(),
      token: getStoredAuthToken(),
      onMessage: (message) => onWorkerMessage(made, audioContext, message),
    });
    return made;
  }, [on, audioContext, name, onWorkerMessage]);

  // The engine lives while the switch is on. It ends with its owner, unless a name press is open: then the worker closes it
  // (`gone`) and the engine ends after the clip is sent.
  useEffect(() => {
    if (engine === null) return undefined;
    const retiring = retiringRef.current;
    return () => {
      if (pressOpenRef.current) {
        retiring.add(engine);
        engine.detach();
      } else {
        engine.end();
      }
    };
  }, [engine]);

  const armed = on && capable && holdsFloor;

  // A failure belongs to one arming: a new engine (the switch, a rename) or conditions that stop or start holding (the floor)
  // are a new try, and the last one's failure is forgotten. Adjusted while rendering, so the row never shows a stale sentence.
  const [armingFailedUnder, setArmingFailedUnder] = useState<{ armed: boolean; engine: EarsEngine | null }>({ armed: false, engine: null });
  if (armingFailedUnder.armed !== armed || armingFailedUnder.engine !== engine) {
    setArmingFailedUnder({ armed, engine });
    if (failure !== null) setFailure(null);
  }

  // THE ARMING. Models first, then the mic. Everything that disarms (the switch, the floor, a rename, a failure, a track that
  // ended) is a change of these dependencies, and the cleanup closes the mic at once.
  useEffect(() => {
    if (!armed || engine === null) return undefined;
    // A failure stands until an event arms again: the effect does not retry by itself.
    if (failure !== null) return undefined;
    let cancelled = false;
    let stream: MediaStream | null = null;
    void (async () => {
      try {
        await engine.arm();
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
        return;
      }
      if (cancelled) return;
      try {
        const opened = await navigator.mediaDevices.getUserMedia(MICROPHONE);
        if (cancelled) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        // A device that went away ends its track: the page found no microphone, and a `devicechange` tries again.
        opened.getAudioTracks().forEach((track) => track.addEventListener('ended', () => {
          if (!cancelled) setFailure(NO_MICROPHONE);
        }, { once: true }));
        await engine.attach(opened);
        if (!cancelled) setListeningEngine(engine);
      } catch (error) {
        if (!cancelled) setFailure(microphoneSentence(error));
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      engine.detach();
      setListeningEngine(null);
    };
  }, [armed, engine, failure]);

  // A page that found no microphone tries again when the browser says its devices changed.
  useEffect(() => {
    if (failure !== NO_MICROPHONE || !capable) return undefined;
    const devices = navigator.mediaDevices;
    const tryAgain = () => setFailure(null);
    devices.addEventListener('devicechange', tryAgain);
    return () => devices.removeEventListener('devicechange', tryAgain);
  }, [failure, capable]);

  // Her voice and his button, told as they change (the engine keeps the last told and tells each arm's worker again).
  useEffect(() => {
    engine?.tell({ kind: 'her-voice', sounding: herVoiceSounding });
  }, [engine, herVoiceSounding]);
  useEffect(() => {
    engine?.tell({ kind: 'button', recording: buttonRecording });
  }, [engine, buttonRecording]);

  const finish = useCallback(() => {
    engine?.tell({ kind: 'finish' });
  }, [engine]);

  const listening = engine !== null && listeningEngine === engine;
  const { state, reason } = earsStateOf({ on, capable, failure, holdsFloor, touched: audioContext !== null, listening, hearing });
  const ears = useMemo<CompanionEars>(() => ({ on, setOn, state, reason }), [on, setOn, state, reason]);
  return { ears, finish };
}
