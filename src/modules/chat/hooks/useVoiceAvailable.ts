import { useEffect, useState } from 'react';

import { useVoiceProvider } from '@/modules/chat/hooks/useVoiceProvider';
import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';

// Voice UI is gated on the `voiceEnabled` UI preference (toggled in Quick Settings /
// the Settings modal) and a configured voice backend.
let healthRequest: Promise<boolean> | null = null;

function checkVoiceHealth(): Promise<boolean> {
  if (healthRequest) return healthRequest;
  const request = api.voice.health()
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      const data = await response.json();
      return data?.configured === true;
    })
    .finally(() => {
      healthRequest = null;
    });
  healthRequest = request;
  return request;
}

/**
 * Whether the voice control for `purpose` should be drawn: 'speak' is read-aloud (the default, MessageSpeakControl) and
 * 'dictate' is the composer's mic (ChatComposer).
 *
 * Read-aloud needs the OpenAI-compatible backend, so its answer is the browser's base URL or the server's health. The mic
 * follows the account's provider: on Gemini the server transcribes on its own key, so the browser needs no backend and the
 * mic is drawn whenever voice input is on. On the OpenAI-compatible provider the mic's answer is read-aloud's, as before.
 */
export function useVoiceAvailable(purpose: 'speak' | 'dictate' = 'speak'): boolean {
  // Read through the shared preferences owner. This used to re-parse the
  // preferences blob and register its own storage + sync listeners, once per
  // assistant message row.
  const { voiceEnabled: enabled } = useUiPreferences();
  // Only the composer's mic reads the provider, and only while voice is on: read-aloud and a page with voice off ask nothing.
  const provider = useVoiceProvider(enabled && purpose === 'dictate');
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const check = async () => {
      if (!enabled) {
        setAvailable(false);
        return;
      }
      if (readVoiceConfig().baseUrl.trim()) {
        setAvailable(true);
        return;
      }
      const id = ++requestId;
      try {
        const result = await checkVoiceHealth();
        if (active && id === requestId) setAvailable(result);
      } catch {
        if (active && id === requestId) setAvailable(false);
      }
    };

    void check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    };
  }, [enabled]);

  if (purpose === 'dictate' && provider === 'gemini') return enabled;
  return enabled && available;
}
