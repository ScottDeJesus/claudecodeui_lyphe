import { useCallback, useEffect, useRef, useState } from 'react';

import { api, refusalSentence } from '@/shared/api';
import type { CompanionPicture, CompanionSettings } from '@/shared/companion-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/**
 * The Settings section's own read and save of Kaylee's settings, for CompanionSettingsSection. It does not use the
 * companion's provider: Settings renders wherever the app does, and the provider lives only in the project workspace, so
 * the section reads `GET /api/companion` itself and writes `PUT /api/companion/settings`.
 *
 * The settings stay current after the first read from the socket: her `companion_settings` frame (another page's save, the
 * panel's model picker or Live switch) replaces them, and a reconnect reads them again, since frames were missed while the
 * socket was down. A read that failed is `loadFailed`, and `retry` is the section's Try again.
 */
export function useCompanionSettings() {
  const { subscribe } = useWebSocket();
  // Her settings as the server holds them: the section draws its fields from this, and nothing else holds them here. Null while the first read is out.
  const [settings, setSettings] = useState<CompanionSettings | null>(null);
  // The read failed: the section says so and offers Try again rather than fields over settings it cannot see.
  const [loadFailed, setLoadFailed] = useState(false);
  // False once the section unmounted: a read or a save that lands then sets nothing.
  const aliveRef = useRef(false);

  const read = useCallback(async () => {
    try {
      const response = await api.companion.picture();
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const picture = (await response.json()) as CompanionPicture;
      if (aliveRef.current) setSettings(picture.settings);
    } catch (error) {
      console.warn('[Companion] Could not read her settings:', error);
      if (aliveRef.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void read();
    return () => {
      aliveRef.current = false;
    };
  }, [read]);

  useEffect(() => subscribe((event) => {
    if (event.kind === 'websocket_reconnected') {
      void read();
    } else if (event.kind === 'companion_settings') {
      setSettings((event as unknown as { settings: CompanionSettings }).settings);
    }
  }), [subscribe, read]);

  /** Try again: the failure notice gives way to the waiting row while the read is out. */
  const retry = useCallback(() => {
    setLoadFailed(false);
    void read();
  }, [read]);

  /** Saves a partial; its answer becomes the settings, and a refusal rejects with the server's own sentence. */
  const save = useCallback(async (patch: Partial<CompanionSettings> | { register: null }) => {
    const response = await api.companion.saveSettings(patch);
    if (!response.ok) throw new Error((await refusalSentence(response)) ?? `Request failed (${response.status})`);
    const saved = (await response.json()) as CompanionSettings;
    if (aliveRef.current) setSettings(saved);
  }, []);

  return { settings, loadFailed, retry, save };
}
