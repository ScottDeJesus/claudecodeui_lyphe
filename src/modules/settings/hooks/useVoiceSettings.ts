import { useCallback, useEffect, useRef, useState } from 'react';

import { api, refusalSentence } from '@/shared/api';
import type { GeminiKeyStatus, VoiceSettings, VoiceSettingsPatch } from '@/shared/types';
import { VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';

/** What one call came to: its parsed answer, or the server's own sentence (null when it sent none) and a plain reason clause. */
type CallOutcome<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; sentence: string | null; reason: string };

/** `GET` and `PUT /api/voice/settings` answer the settings and the key's status together. */
type SettingsAnswer = { settings: VoiceSettings; key: GeminiKeyStatus };

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

function asVoiceSettings(value: unknown): VoiceSettings | null {
  if (!isRecord(value) || !isRecord(value.gemini)) return null;
  const { provider } = value;
  const { transcriptionModel, speechModel, voice, soundTags } = value.gemini;
  if (provider !== 'openai' && provider !== 'gemini') return null;
  if (typeof transcriptionModel !== 'string' || typeof speechModel !== 'string' || typeof voice !== 'string') return null;
  if (!Array.isArray(soundTags) || !soundTags.every((tag) => typeof tag === 'string')) return null;
  return { provider, gemini: { transcriptionModel, speechModel, voice, soundTags } };
}

/**
 * The settings answer, or null when the body is not one. The API's own envelope for a restart or an expired token
 * (`{ success: false, error }`) parses as JSON too, so a body is only trusted once both halves have their shape.
 */
function parseSettingsAnswer(body: unknown): SettingsAnswer | null {
  if (!isRecord(body)) return null;
  const settings = asVoiceSettings(body.settings);
  const key = asKeyStatus(body.key);
  return settings && key ? { settings, key } : null;
}

/** The answer of a key save or clear: `{ key }` alone. */
function parseKeyAnswer(body: unknown): GeminiKeyStatus | null {
  return isRecord(body) ? asKeyStatus(body.key) : null;
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
  /** A save is out or queued behind one. */
  saving: boolean;
  /** The sentence for the last refused save; while `keyStatus` is still null, the reason the read failed. Null when none. */
  error: string | null;
  /**
   * `error`'s sentence when the last refused save was the provider's, else null. The picker draws it under itself: the
   * card that draws `error` sits two sections below the picker, off screen from it.
   */
  providerRefusal: string | null;
  /** Merges a partial into the account's settings. A change of provider tells the open composers (VOICE_CONFIG_SYNC_EVENT) once the server has it. */
  saveSettings: (patch: VoiceSettingsPatch) => Promise<void>;
  /** Stores this as the account's Gemini key, replacing any earlier one. The key is passed through, never kept here. */
  saveKey: (key: string) => Promise<void>;
  /** Forgets the account's stored key, so the house's key serves again. */
  clearKey: () => Promise<void>;
  /** Reads the settings again, for the Try again of a read that failed. */
  retry: () => Promise<void>;
};

/**
 * The one reader and writer of the account's voice settings and its Gemini key in `src/`: `GET`, `PUT /api/voice/settings`
 * and `PUT`, `DELETE /api/voice/gemini-key`. Used by the settings module's VoiceSettingsTab, which hands them to the
 * provider picker and the Gemini section.
 *
 * Nothing is optimistic: what the page draws is the server's last answer, so a refused save leaves the old value
 * standing with the server's sentence under it. Saves run one at a time in the order they were made, so two quick picks
 * cannot land out of order, and a read that was out when a save landed is dropped as older than it.
 *
 * The provider is the one setting other parts of the page follow: after a save that carried it lands, the voice-config
 * sync event goes out, which the chat's `useVoiceAvailable` and `useVoiceProvider` re-check on, so an open composer
 * follows the picker in the same tab.
 */
export function useVoiceSettings(): VoiceSettingsState {
  // The settings as the server last answered, drawn by the picker and the model field. Null before any answer: the page
  // has no honest value to draw then, and the shipped defaults would overwrite a good one on the next save.
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  // The key's source and last four, drawn by the Gemini section's key line. Null until the first answer.
  const [keyStatus, setKeyStatus] = useState<GeminiKeyStatus | null>(null);
  // True from a save's request until its answer, so the section's buttons wait and "Saving…" shows.
  const [saving, setSaving] = useState(false);
  // The last refusal (or, before any read has landed, the failed read's reason), drawn under the Gemini card.
  const [error, setError] = useState<string | null>(null);
  // The same sentence when it was a provider save that was refused, so the picker can say why it snapped back.
  const [providerRefusal, setProviderRefusal] = useState<string | null>(null);

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

  /** Queues one save behind the earlier ones. Resolves with the server's taking it, or the sentence for why it did not. */
  const enqueueSave = useCallback(<TValue>(
    request: () => Promise<Response>,
    parse: (body: unknown) => TValue | null,
    apply: (value: TValue) => void,
  ): Promise<SaveOutcome> => {
    const queue = queueRef.current;
    queue.outstanding += 1;
    if (aliveRef.current) {
      setSaving(true);
      setError(null);
      setProviderRefusal(null);
    }
    const run = queue.tail.then(async (): Promise<SaveOutcome> => {
      const outcome = await callVoiceApi(request, parse);
      if (outcome.ok) landedSavesRef.current += 1;
      queue.outstanding -= 1;
      const sentence = outcome.ok ? null : outcome.sentence ?? `Not saved: ${outcome.reason}.`;
      if (aliveRef.current) {
        if (outcome.ok) apply(outcome.value);
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
  }, []);

  const saveSettings = useCallback(async (patch: VoiceSettingsPatch) => {
    const outcome = await enqueueSave(() => api.voice.saveSettings(patch), parseSettingsAnswer, applySettingsAnswer);
    if (patch.provider === undefined) return;
    if (!outcome.landed) {
      if (aliveRef.current) setProviderRefusal(outcome.sentence);
      return;
    }
    // Sent after the answer, not before: the listeners ask the server which provider is picked, and it must already know.
    window.dispatchEvent(new Event(VOICE_CONFIG_SYNC_EVENT));
  }, [enqueueSave, applySettingsAnswer]);

  const saveKey = useCallback(async (key: string) => {
    await enqueueSave(() => api.voice.saveGeminiKey(key), parseKeyAnswer, setKeyStatus);
  }, [enqueueSave]);

  const clearKey = useCallback(async () => {
    await enqueueSave(() => api.voice.clearGeminiKey(), parseKeyAnswer, setKeyStatus);
  }, [enqueueSave]);

  return { settings, keyStatus, saving, error, providerRefusal, saveSettings, saveKey, clearKey, retry };
}
