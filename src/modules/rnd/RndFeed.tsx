import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RND_ALL_TOPIC, useLiveBus } from '@/modules/live-bus';
import { registerReread, sayFeedFailure } from '@/modules/rnd/hooks/useRnd';
import { isRecord, readBody, sentenceOf } from '@/modules/rnd/rndWire';
import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { RndCandidate, RndPicture, RndSettings, RndStanding } from '@/shared/rnd-types';

/**
 * THE R&D LANE'S FEED: seeds the picture from GET /api/rnd, then keeps it from the rnd_state frames the server sends on a change,
 * publishing it on the live bus (RND_ALL_TOPIC) for the panel and for the wheel's mark. Mounted once, in App.tsx beside
 * RoadmapFeed, so the mark is lit whichever page is on screen.
 *
 * A RECONNECT RE-SEEDS, as RoadmapFeed's does: the lane speaks only on a change, so a write that landed while the socket was down
 * would otherwise show its old picture until the next one. A failed read is said (useRnd's failure) rather than only logged,
 * because the panel has a screen for it; a frame or a read that answers takes the sentence back.
 */
export function RndFeed({ children }: { children: ReactNode }) {
  const { subscribe } = useWebSocket();
  const bus = useLiveBus();
  const { t } = useTranslation();

  useEffect(() => {
    // Guards the seed's async tail: a response landing after unmount publishes into no bus.
    let cancelled = false;

    const put = (picture: RndPicture, at: number, guarded: boolean): boolean => {
      const held = bus.get<RndPicture>(RND_ALL_TOPIC);
      if (guarded && held && held.at >= at) return false;
      if (held && sameReading(held.payload, picture)) return false;
      bus.publish(RND_ALL_TOPIC, picture, at);
      return true;
    };

    const seed = async () => {
      try {
        const response = await api.rnd.picture();
        const body = await readBody(response);
        if (cancelled) return;
        const picture = asPicture(body);
        // The lane answers { error } until this boot has read the dispatcher: said, and the next frame takes it back.
        if (!response.ok || picture === null) {
          sayFeedFailure(sentenceOf(body) || t('messages.operationFailed'));
          return;
        }
        sayFeedFailure(null);
        put(picture, isRecord(body) && typeof body.at === 'number' ? body.at : Date.now(), true);
      } catch (error) {
        if (cancelled) return;
        console.warn('[RndFeed] the R&D picture could not be read:', error);
        sayFeedFailure(t('messages.networkError'));
      }
    };

    const unregister = registerReread(() => void seed());
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'websocket_reconnected') {
        void seed();
        return;
      }
      if (event.kind !== 'rnd_state') return;
      const picture = asPicture(event);
      if (picture === null) return;
      sayFeedFailure(null);
      put(picture, typeof event.at === 'number' ? event.at : Date.now(), false);
    });

    void seed();

    return () => {
      cancelled = true;
      unregister();
      unsubscribe();
    };
  }, [subscribe, bus, t]);

  return <>{children}</>;
}

/** Whether two pictures say the same thing: equal in everything but the generated_at the dispatcher restamps on every read. */
function sameReading(held: RndPicture, incoming: RndPicture): boolean {
  return JSON.stringify({ ...held, generated_at: '' }) === JSON.stringify({ ...incoming, generated_at: '' });
}

/**
 * The picture's five keys out of a frame or a response body, or null when the value is not the whole picture. The server has
 * checked every field (rnd-state.service.ts); this only refuses a body that is not that document at all, such as the lane's
 * { error } before its first read, and leaves off the frame's kind and at.
 */
function asPicture(value: unknown): RndPicture | null {
  if (!isRecord(value)) return null;
  const { generated_at: generatedAt, settings, scout, standing, candidates } = value;
  if (typeof generatedAt !== 'string') return null;
  if (!isRecord(settings) || !Array.isArray(settings.sources) || typeof settings.web_search !== 'boolean') return null;
  if (!isRecord(scout) || !isRecord(standing) || !Array.isArray(candidates)) return null;
  return {
    generated_at: generatedAt,
    settings: settings as RndSettings,
    scout: scout as RndPicture['scout'],
    standing: standing as RndStanding,
    candidates: candidates as RndCandidate[],
  };
}
