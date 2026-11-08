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
 * The mic is drawn whenever voice input is on: the server transcribes every clip on its own (the account's home server, Gemini the
 * backup), so the browser needs no backend and the account's provider has no say. Read-aloud follows the provider. On Gemini the
 * server speaks on its own key, so it is drawn when the server's health says the account has a Gemini key in reach (the browser's
 * own base URL is never reached on Gemini, so it does not count). On the OpenAI-compatible provider the answer is the browser's
 * base URL or the proxy's configuration, which the server's health reports.
 */
export function useVoiceAvailable(purpose: 'speak' | 'dictate' = 'speak'): boolean {
  // Read through the shared preferences owner. This used to re-parse the
  // preferences blob and register its own storage + sync listeners, once per
  // assistant message row.
  const { voiceEnabled: enabled } = useUiPreferences();
  // Only read-aloud follows the provider, and only while voice is on: a page with voice off, and the mic, ask the server nothing here.
  const followsProvider = enabled && purpose === 'speak';
  const provider = useVoiceProvider(followsProvider);
  // Whether the backend this account's provider names is ready: the base URL or the server's health. Settled by the effect below, from a request that cannot run while rendering.
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const check = async () => {
      if (!followsProvider) {
        setAvailable(false);
        return;
      }
      // A base URL held by the browser is an endpoint of its own, and only an OpenAI-compatible account ever reaches it.
      if (provider === 'openai' && readVoiceConfig().baseUrl.trim()) {
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
  }, [followsProvider, provider]);

  if (purpose === 'dictate') return enabled;
  return enabled && available;
}
