import { useCallback, useEffect, useRef, useState } from 'react';

import { api, refusalSentence } from '@/shared/api';
import type { GeminiKeyStatus, HomeServerKeyStatus, VoiceSettings, VoiceSettingsPatch } from '@/shared/types';
import { VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';

/** What one call came to: its parsed answer, or the server's own sentence (null when it sent none) and a plain reason clause. */
type CallOutcome<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; sentence: string | null; reason: string };

/** `GET` and `PUT /api/voice/settings` answer the settings and both keys' statuses together. */
type SettingsAnswer = { settings: VoiceSettings; key: GeminiKeyStatus; homeServerKey: HomeServerKeyStatus };

/** What a server that predates the home server says of its key by saying nothing: no key, so the home server is off. */
const NO_HOME_SERVER_KEY: HomeServerKeyStatus = { source: 'none', last4: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asKeyStatus(value: unknown): GeminiKeyStatus | null {
  if (!isRecord(value)) return null;
  const { source, last4 } = value;
  const sourceKnown = source === 'stored' || source === 'house' || source === 'none';
  if (!sourceKnown || (last4 !== null && typeof last4 !== 'string')) return null;
  return { source, last4 };
}

function asHomeServerKeyStatus(value: unknown): HomeServerKeyStatus | null {
  if (!isRecord(value)) return null;
  const { source, last4 } = value;
  if ((source !== 'stored' && source !== 'none') || (last4 !== null && typeof last4 !== 'string')) return null;
  return { source, last4 };
}

/** The home server's saved address, or null when none is saved. A server that predates the setting sends no `homeServer`, which reads as none. */
function asHomeServerAddress(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const { address } = value;
  return typeof address === 'string' || address === null ? address : undefined;
}

function asVoiceSettings(value: unknown): VoiceSettings | null {
  if (!isRecord(value) || !isRecord(value.gemini)) return null;
  const { provider } = value;
  const { transcriptionModel, speechModel, voice, soundTags } = value.gemini;
  // A server that predates the setting does not send it: cleanup is on by default, so absent reads as on.
  const cleanTranscripts = value.cleanTranscripts !== false;
  if (provider !== 'openai' && provider !== 'gemini') return null;
  if (typeof transcriptionModel !== 'string' || typeof speechModel !== 'string' || typeof voice !== 'string') return null;
  if (!Array.isArray(soundTags) || !soundTags.every((tag) => typeof tag === 'string')) return null;
  const address = asHomeServerAddress(value.homeServer);
  if (address === undefined) return null;
  return { provider, cleanTranscripts, homeServer: { address }, gemini: { transcriptionModel, speechModel, voice, soundTags } };
}

/**
 * The settings answer, or null when the body is not one. The API's own envelope for a restart or an expired token
 * (`{ success: false, error }`) parses as JSON too, so a body is only trusted once both halves have their shape.
 */
function parseSettingsAnswer(body: unknown): SettingsAnswer | null {
  if (!isRecord(body)) return null;
  const settings = asVoiceSettings(body.settings);
  const key = asKeyStatus(body.key);
  const homeServerKey = body.homeServerKey === undefined ? NO_HOME_SERVER_KEY : asHomeServerKeyStatus(body.homeServerKey);
  return settings && key && homeServerKey ? { settings, key, homeServerKey } : null;
}

/** The answer of a Gemini key save or clear: `{ key }` alone. */
function parseKeyAnswer(body: unknown): GeminiKeyStatus | null {
  return isRecord(body) ? asKeyStatus(body.key) : null;
}

/** The answer of a home server key save or clear: `{ homeServerKey }` alone. */
function parseHomeServerKeyAnswer(body: unknown): HomeServerKeyStatus | null {
  return isRecord(body) ? asHomeServerKeyStatus(body.homeServerKey) : null;
}

/**
 * Runs one request and judges its answer without ever throwing. A refusal carries the server's own sentence; a
 * network failure or an answer of the wrong shape carries only a reason, for the caller to word. Nothing here logs
 * the request: a key save's body is the key.
 */
async function callVoiceApi<TValue>(
  request: () => Promise<Response>,
  parse: (body: unknown) => TValue | null,
): Promise<CallOutcome<TValue>> {
  let response: Response;
  try {
    response = await request();
  } catch {
    return { ok: false, sentence: null, reason: 'the server could not be reached' };
  }
  if (!response.ok) {
    return { ok: false, sentence: await refusalSentence(response), reason: `the server answered ${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, sentence: null, reason: "the server's answer was not understood" };
  }
  const value = parse(body);
  return value === null
    ? { ok: false, sentence: null, reason: "the server's answer was not understood" }
    : { ok: true, value };
}

/** How one queued save ended: the server took it, or its sentence for why not. */
type SaveOutcome = { landed: true } | { landed: false; sentence: string };

type VoiceSettingsState = {
  /** The account's voice settings as the server last answered them; null until the first read lands (and while a read has failed). */
  settings: VoiceSettings | null;
  /** Which Gemini key the account uses, never the key itself; null until the first read lands. */
  keyStatus: GeminiKeyStatus | null;
  /** Whether the account has a home server key (and its last four), never the key itself; null until the first read lands. */
  homeServerKey: HomeServerKeyStatus | null;
  /** A save is out or queued behind one. */
  saving: boolean;
  /** The sentence for the last refused save; while `keyStatus` is still null, the reason the read failed. Null when none. */
  error: string | null;
  /**
   * `error`'s sentence when the last refused save was the provider's, else null. The picker draws it under itself: the
   * card that draws `error` sits two sections below the picker, off screen from it.
   */
  providerRefusal: string | null;
  /**
   * The sentence for the last refused save of the home server (its address or its key), else null. The home server's card draws it
   * under itself, and `error` never holds it, so the Gemini card below does not repeat a refusal that is not its own.
   */
  homeServerRefusal: string | null;
  /** Merges a partial into the account's settings. A change of provider tells the open composers (VOICE_CONFIG_SYNC_EVENT) once the server has it. */
  saveSettings: (patch: VoiceSettingsPatch) => Promise<void>;
  /** Stores this as the account's Gemini key, replacing any earlier one, and tells the open message rows once the server has it. The key is passed through, never kept here. */
  saveKey: (key: string) => Promise<void>;
  /** Forgets the account's stored key, so the house's key serves again, and tells the open message rows once the server has done it. */
  clearKey: () => Promise<void>;
  /** Stores this as the account's home server key, replacing any earlier one. The key is passed through, never kept here. */
  saveHomeServerKey: (key: string) => Promise<void>;
  /** Forgets the account's home server key, which turns the home server off: Gemini then transcribes alone. */
  clearHomeServerKey: () => Promise<void>;
  /** Reads the settings again, for the Try again of a read that failed. */
  retry: () => Promise<void>;
};

/**
 * The one reader and writer of the account's voice settings and its two keys in `src/`: `GET`, `PUT /api/voice/settings`
 * and `PUT`, `DELETE /api/voice/gemini-key` and `/api/voice/home-server-key`. Used by the settings module's VoiceSettingsTab, which
 * hands them to the provider picker, the home server section and the Gemini section.
 *
 * Nothing is optimistic: what the page draws is the server's last answer, so a refused save leaves the old value
 * standing with the server's sentence under it. Saves run one at a time in the order they were made, so two quick picks
 * cannot land out of order, and a read that was out when a save landed is dropped as older than it.
 *
 * The provider and the key are the settings other parts of the page follow: after a save that carried the provider lands, and
 * after a key save or clear lands, the voice-config sync event goes out, which the chat's `useVoiceAvailable` and
 * `useVoiceProvider` re-check on, so an open composer follows the picker, and a message's read-aloud button follows the
 * key (on Gemini it is drawn only while a key is in reach), in the same tab.
 */
export function useVoiceSettings(): VoiceSettingsState {
  // The settings as the server last answered, drawn by the picker and the model field. Null before any answer: the page
  // has no honest value to draw then, and the shipped defaults would overwrite a good one on the next save.
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  // The key's source and last four, drawn by the Gemini section's key line. Null until the first answer.
  const [keyStatus, setKeyStatus] = useState<GeminiKeyStatus | null>(null);
  // Whether the home server has a key, and its last four, drawn by the home server section's key line. Null until the first answer.
  const [homeServerKey, setHomeServerKey] = useState<HomeServerKeyStatus | null>(null);
  // True from a save's request until its answer, so the section's buttons wait and "Saving…" shows.
  const [saving, setSaving] = useState(false);
  // The last refusal (or, before any read has landed, the failed read's reason), drawn under the Gemini card.
  const [error, setError] = useState<string | null>(null);
  // The same sentence when it was a provider save that was refused, so the picker can say why it snapped back.
  const [providerRefusal, setProviderRefusal] = useState<string | null>(null);
  // The sentence of a refused home server save (address or key), drawn under the home server's card and nowhere else.
  const [homeServerRefusal, setHomeServerRefusal] = useState<string | null>(null);

  // False once unmounted: a save outlives the tab that made it, and a closed tab has nothing to draw.
  const aliveRef = useRef(true);
  // The saves' queue: the tail every new save waits behind, and how many are out, which `saving` is derived from.
  const queueRef = useRef<{ tail: Promise<void>; outstanding: number }>({ tail: Promise.resolve(), outstanding: 0 });
  // Counts the saves that landed. A read compares it with the count at its start to know a save has overtaken it.
  const landedSavesRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const read = useCallback((): Promise<void> => {
    const landedBefore = landedSavesRef.current;
    return callVoiceApi(api.voice.settings, parseSettingsAnswer).then((outcome) => {
      // A save that landed while this read was out is newer than it, and the tab may be gone.
      if (!aliveRef.current || landedSavesRef.current !== landedBefore) return;
      if (outcome.ok) {
        setSettings(outcome.value.settings);
        setKeyStatus(outcome.value.key);
        setHomeServerKey(outcome.value.homeServerKey);
        setError(null);
      } else {
        setError(outcome.sentence ?? outcome.reason);
      }
    });
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const retry = useCallback(async () => {
    setError(null);
    await read();
  }, [read]);

  /**
   * Queues one save behind the earlier ones. Resolves with the server's taking it, or the sentence for why it did not.
   * `aboutHomeServer` sends a refusal to `homeServerRefusal` instead of `error`.
   */
  const enqueueSave = useCallback(<TValue>(
    request: () => Promise<Response>,
    parse: (body: unknown) => TValue | null,
    apply: (value: TValue) => void,
    aboutHomeServer = false,
  ): Promise<SaveOutcome> => {
    const queue = queueRef.current;
    queue.outstanding += 1;
    if (aliveRef.current) {
      setSaving(true);
      setError(null);
      setProviderRefusal(null);
      setHomeServerRefusal(null);
    }
    const run = queue.tail.then(async (): Promise<SaveOutcome> => {
      const outcome = await callVoiceApi(request, parse);
      if (outcome.ok) landedSavesRef.current += 1;
      queue.outstanding -= 1;
      const sentence = outcome.ok ? null : outcome.sentence ?? `Not saved: ${outcome.reason}.`;
      if (aliveRef.current) {
        if (outcome.ok) apply(outcome.value);
        else if (aboutHomeServer) setHomeServerRefusal(sentence);
        else setError(sentence);
        setSaving(queue.outstanding > 0);
      }
      return sentence === null ? { landed: true } : { landed: false, sentence };
    });
    // callVoiceApi never throws, so the tail never rejects and one failed save cannot stop the ones behind it.
    queue.tail = run.then(() => undefined);
    return run;
  }, []);

  const applySettingsAnswer = useCallback((answer: SettingsAnswer) => {
    setSettings(answer.settings);
    setKeyStatus(answer.key);
    setHomeServerKey(answer.homeServerKey);
  }, []);

  const saveSettings = useCallback(async (patch: VoiceSettingsPatch) => {
    const outcome = await enqueueSave(() => api.voice.saveSettings(patch), parseSettingsAnswer, applySettingsAnswer, patch.homeServer !== undefined);
    if (patch.provider === undefined) return;
    if (!outcome.landed) {
      if (aliveRef.current) setProviderRefusal(outcome.sentence);
      return;
    }
    // Sent after the answer, not before: the listeners ask the server which provider is picked, and it must already know.
    window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
  }, [enqueueSave, applySettingsAnswer]);

  const saveKey = useCallback(async (key: string) => {
    const outcome = await enqueueSave(() => api.voice.saveGeminiKey(key), parseKeyAnswer, setKeyStatus);
    // After the answer, like the provider's: the listeners ask the server whether a key is in reach, and it must already know.
    if (outcome.landed) window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
  }, [enqueueSave]);

  const clearKey = useCallback(async () => {
    const outcome = await enqueueSave(() => api.voice.clearGeminiKey(), parseKeyAnswer, setKeyStatus);
    if (outcome.landed) window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
  }, [enqueueSave]);

  const saveHomeServerKey = useCallback(async (key: string) => {
    await enqueueSave(() => api.voice.saveHomeServerKey(key), parseHomeServerKeyAnswer, setHomeServerKey, true);
  }, [enqueueSave]);

  const clearHomeServerKey = useCallback(async () => {
    await enqueueSave(() => api.voice.clearHomeServerKey(), parseHomeServerKeyAnswer, setHomeServerKey, true);
  }, [enqueueSave]);

  return {
    settings, keyStatus, homeServerKey, saving, error, providerRefusal, homeServerRefusal,
    saveSettings, saveKey, clearKey, saveHomeServerKey, clearHomeServerKey, retry,
  };
}
