import { useCallback, useEffect, useRef, useState } from 'react';

import { isFace } from '@/modules/companion/utils/companionReducer';
import { api, refusalSentence } from '@/shared/api';
import type { CompanionFace, CompanionPicture, CompanionSettings } from '@/shared/companion-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/**
 * The Settings section's own read and save of Kaylee's settings, for CompanionSettingsSection. It does not use the
 * companion's provider: Settings renders wherever the app does, and the provider lives only in the project workspace, so
 * the section reads `GET /api/companion` itself and writes `PUT /api/companion/settings`.
 *
 * The settings stay current after the first read from the socket: her `companion_settings` frame (another page's save, the
 * panel's model picker or Live switch) replaces them, and a reconnect reads them again, since frames were missed while the
 * socket was down. A read that failed is `loadFailed`, and `retry` is the section's Try again.
 *
 * The same read carries `picture.face`, which this hook hands on as `face` for the face card (CompanionFaceSettings) to start from:
 * the card follows the `companion_face` frames itself (hooks/useCompanionFaceSettings.ts), and a read again hands it a new `face`.
 * Null until the first read lands (or when the read's face is no face the reducer's `isFace` accepts), so the card is mounted only
 * with a face it knows. A frame carries no sequence and is newer than a read begun before it arrived, so a read that was out while a
 * `companion_face` frame came hands on that frame's face instead of its own (the bake's last frame is never repeated, so an older
 * snapshot landing after it would be the face for good): this hook only notes the newest frame, and the card follows them itself.
 */
export function useCompanionSettings() {
  const { subscribe } = useWebSocket();
  // Her settings as the server holds them: the section draws its fields from this, and nothing else holds them here. Null while the first read is out.
  const [settings, setSettings] = useState<CompanionSettings | null>(null);
  // Her face as the same read carried it: the face card starts from it and follows its own frames after. It is not derivable from `settings`, and a frame does not change it, so each read hands the card a new object. Null while the first read is out.
  const [face, setFace] = useState<CompanionFace | null>(null);
  // The read failed: the section says so and offers Try again rather than fields over settings it cannot see.
  const [loadFailed, setLoadFailed] = useState(false);
  // False once the section unmounted: a read or a save that lands then sets nothing.
  const aliveRef = useRef(false);
  // How many `companion_face` frames have come and the face of the newest, for a read to answer with when a frame came while it was out. A ref: it is read inside `read` and nothing is drawn from it.
  const faceFrameRef = useRef<{ heard: number; face: CompanionFace | null }>({ heard: 0, face: null });

  const read = useCallback(async () => {
    const heard = faceFrameRef.current.heard;
    try {
      const response = await api.companion.picture();
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const picture = (await response.json()) as CompanionPicture;
      if (aliveRef.current) {
        setSettings(picture.settings);
        const frame = faceFrameRef.current;
        setFace(frame.heard !== heard ? frame.face : isFace(picture.face) ? picture.face : null);
      }
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
    } else if (event.kind === 'companion_face') {
      const frameFace = (event as unknown as { face: unknown }).face;
      if (isFace(frameFace)) faceFrameRef.current = { heard: faceFrameRef.current.heard + 1, face: frameFace };
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

  return { settings, face, loadFailed, retry, save };
}
