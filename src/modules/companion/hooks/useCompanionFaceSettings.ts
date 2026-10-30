import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isFace } from '@/modules/companion/utils/companionReducer';
import { api, refusalSentence } from '@/shared/api';
import type { CompanionFace } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/** The face in a `{ face }` answer, or null when the body is not JSON or carries no face (a proxy's page, another server's JSON): the frames of the bake or restore bring the face, and the card never draws what it cannot read. */
async function faceOfAnswer(response: Response): Promise<CompanionFace | null> {
  const face = await response.json().then((body: { face?: unknown } | null) => body?.face, () => null);
  return isFace(face) ? face : null;
}

/**
 * Used by this module's CompanionFaceSettings, which draws Settings > Voice > Companion's "Her face" card from what it returns.
 *
 * The card's face and the four things he does to it. It makes NO READ of its own: `initial` is the face the section's one
 * `GET /api/companion` carried (CompanionSettingsSection, through useCompanionSettings), and the face stays current from the socket
 * after that, as her settings do: the account's `companion_face` frame (another page's upload, a frame of a bake made, the end of
 * it, a restore from anywhere) replaces the face. A new `initial` (the section's read again on `websocket_reconnected`, since frames
 * were missed while the socket was down) replaces it too. Settings renders wherever the app does and her provider lives only in the
 * project workspace, so the card cannot use the provider's picture.
 *
 * WHICH SOURCE WINS. A frame carries no sequence, and the frames keep coming while the bake runs, so a frame that arrives while
 * a request of this card is out is newer than that request's answer: the answer is not taken over it (`frameCountRef`). The same rule
 * for the section's reads lives in useCompanionSettings. A frame, an answer or a read is judged by the reducer's `isFace`, the one rule
 * for what a face is, so a face the card cannot draw is never drawn.
 *
 * UPLOAD answers 200 `{ face }` when that photo's face was already made (hers at once) and 202 `{ face }` while it is made; the
 * frames then count the bake to its end, one per frame rendered, and the card takes each. A refused upload (400
 * `COMPANION_FACE_INVALID`, or any other refusal) is the server's own sentence, `refusal`, shown under the button; the face stays as it was.
 * RESTORE (`DELETE`) answers the original and drops a pending bake; a restore that fails is a warn toast, with the server's sentence under
 * it when the server gave one. SEE EVERY FRAME fetches the contact sheet through the app's authenticated client (an `<img src>` to the
 * route would carry no token) and shows it from an object URL, revoked as the lightbox closes or the card goes. A fetch that fails is
 * a warn toast the same way. Neither toast carries the transport's own words (`Failed to fetch`).
 */
export function useCompanionFaceSettings(initial: CompanionFace) {
  const { t } = useTranslation('settings');
  const { subscribe } = useWebSocket();
  const pushToast = useToast();
  // The face the card draws: starts as the section's read, then follows frames and the answers of upload and restore. It cannot be
  // derived from `initial` once a frame has come: the frame is newer than the read, and nothing else in this page holds it.
  const [current, setCurrent] = useState(initial);
  // The read `current` was last reset to. A new `initial` (the section read her picture again) is newer than anything held here, and
  // this is how the render sees it arrive; set while rendering, which React re-runs at once, so the card never draws the older face.
  const [handedIn, setHandedIn] = useState(initial);
  // His photo is out, from the press until the server has answered: Upload turns its glyph and refuses a second press. It cannot be
  // derived: nothing else in the page knows a request is in flight.
  const [uploading, setUploading] = useState(false);
  // The server's sentence for the photo it refused (or the words for a photo that never arrived), drawn under Upload a photo; null when the last upload was not refused.
  const [refusal, setRefusal] = useState<string | null>(null);
  // The contact sheet is being fetched for the lightbox: See every frame turns its glyph and refuses a second press.
  const [framesOpening, setFramesOpening] = useState(false);
  // The contact sheet's object URL while the lightbox is open, null when it is shut. A URL is made from the fetched bytes and must be revoked, so it is held here until the lightbox closes.
  const [contactUrl, setContactUrl] = useState<string | null>(null);
  // False once the card unmounted: an answer that lands then sets nothing.
  const aliveRef = useRef(false);
  // True from the first press of a control until its answer is in. The states above are only what the last render saw, so two presses
  // in one task (before React has rendered) would each pass a check of them and send two requests; a ref changes at once.
  const uploadingRef = useRef(false);
  const restoringRef = useRef(false);
  const openingRef = useRef(false);
  // How many `companion_face` frames this card has heard. A request notes it when it starts and takes its answer's face only if no
  // frame came while it was out: that frame is newer, and the announce of the request's own change is among the frames. A ref: it is read
  // inside callbacks and nothing is drawn from it.
  const frameCountRef = useRef(0);

  if (initial !== handedIn) {
    setHandedIn(initial);
    setCurrent(initial);
  }

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => subscribe((event) => {
    if (event.kind !== 'companion_face') return;
    const face = (event as unknown as { face: unknown }).face;
    if (!isFace(face)) return;
    frameCountRef.current += 1;
    setCurrent(face);
  }), [subscribe]);

  // The object URL lives exactly as long as the lightbox shows it: closing (null) or leaving revokes it.
  useEffect(() => {
    if (contactUrl === null) return undefined;
    return () => URL.revokeObjectURL(contactUrl);
  }, [contactUrl]);

  /** Sends his photo to be made into her face. The answer's face is hers at once (200) or the bake's start (202); a refusal is the sentence under the button. */
  const upload = useCallback(async (file: File) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setRefusal(null);
    const heard = frameCountRef.current;
    // For a photo that did not arrive, or was refused without a sentence of its own.
    const notSent = t('voiceSettings.companion.face.uploadFailed', { defaultValue: "That photo couldn't be sent. Try again." });
    try {
      const response = await api.companion.face.upload(file);
      if (response.ok) {
        const face = await faceOfAnswer(response);
        // An answer with no face (not JSON, or none in it) to a photo that was taken is not a refusal: the frames of its bake bring the face.
        if (face === null) console.warn('[Companion] The upload was accepted but its answer carried no face.');
        else if (aliveRef.current && frameCountRef.current === heard) setCurrent(face);
      } else {
        const sentence = await refusalSentence(response);
        console.warn(`[Companion] Her photo was refused (${response.status}): ${sentence ?? 'no sentence'}`);
        if (aliveRef.current) setRefusal(sentence ?? notSent);
      }
    } catch (error) {
      console.warn('[Companion] Her photo could not be sent:', error);
      if (aliveRef.current) setRefusal(notSent);
    } finally {
      uploadingRef.current = false;
      if (aliveRef.current) setUploading(false);
    }
  }, [t]);

  /** Puts her original face back and drops a bake still being made. Called from the confirm alone. */
  const restore = useCallback(async () => {
    if (restoringRef.current) return;
    restoringRef.current = true;
    // A refusal is about a photo that is going away; it would be stale under the button once the restore lands.
    setRefusal(null);
    const heard = frameCountRef.current;
    const failed = t('voiceSettings.companion.face.restoreFailed', { defaultValue: "Her original face wasn't restored" });
    try {
      const response = await api.companion.face.restore();
      if (response.ok) {
        const face = await faceOfAnswer(response);
        if (face !== null && aliveRef.current && frameCountRef.current === heard) setCurrent(face);
      } else {
        pushToast({ tone: 'warn', title: failed, message: (await refusalSentence(response)) ?? undefined });
      }
    } catch (error) {
      console.warn('[Companion] Her original face could not be restored:', error);
      pushToast({ tone: 'warn', title: failed });
    } finally {
      restoringRef.current = false;
    }
  }, [pushToast, t]);

  const faceId = current.id;
  /** Fetches the contact sheet of the face drawn now and opens it: its object URL becomes `contactUrl`. */
  const seeFrames = useCallback(async () => {
    if (openingRef.current || faceId === null) return;
    openingRef.current = true;
    setFramesOpening(true);
    const failed = t('voiceSettings.companion.face.framesFailed', { defaultValue: "Her frames couldn't be opened" });
    try {
      const response = await api.companion.face.contact(faceId);
      if (response.ok) {
        const sheet = await response.blob();
        // Made only for a card that is still here: a URL made after the unmount would have nothing to revoke it.
        if (aliveRef.current) setContactUrl(URL.createObjectURL(sheet));
      } else {
        pushToast({ tone: 'warn', title: failed, message: (await refusalSentence(response)) ?? undefined });
      }
    } catch (error) {
      console.warn('[Companion] Her frames could not be fetched:', error);
      pushToast({ tone: 'warn', title: failed });
    } finally {
      openingRef.current = false;
      if (aliveRef.current) setFramesOpening(false);
    }
  }, [faceId, pushToast, t]);

  /** The lightbox was closed: its URL goes (the effect above revokes it) and the sheet is gone from the page. */
  const closeFrames = useCallback(() => setContactUrl(null), []);

  return { face: current, uploading, refusal, framesOpening, contactUrl, upload, restore, seeFrames, closeFrames };
}
