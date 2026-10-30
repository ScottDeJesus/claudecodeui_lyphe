import { useMemo } from 'react';

import type { CompanionLogEntry, CompanionPicture } from '@/shared/companion-types';
import type { CompanionFaceLook, CompanionFaceSentences, CompanionVoice } from '@/shared/types';

type FaceInputsArgs = {
  /** Her picture: the log her sentences are read from, the running turn's id and the floor. Null until the first read. */
  picture: CompanionPicture | null;
  /** This page's voice: `speaking` is the sentence its player is sounding, and `on` its switch. */
  voice: CompanionVoice;
  /** This page's name for her, to know whether it holds the floor and so plays her voice. */
  clientId: string;
  /** The rect of the anchor the disc is drawing a look at, null when none is drawn: none holds, or a drag is in hand or set the look aside. */
  anchor: DOMRect | null;
  /** Her rest's box: where she stands at home, which the disc reports. Null before the kit has placed her. */
  rest: DOMRect | null;
  /** Where she is drawn while the look holds, the disc's top-left; null when no look is drawn. */
  target: { left: number; top: number } | null;
  /** The disc's side as she is drawn now: her target's centre is half of it in from the target's corner. */
  size: number;
  /** She has landed at the look drawn: her glide ended (or, under reduced motion, there was none). Read only with an anchor. */
  landed: boolean;
};

const NO_LOG: CompanionLogEntry[] = [];

/** The newest entry of hers (a sentence) that `matches`, scanning the log from its newest end. */
function newestOfHers(log: CompanionLogEntry[], matches: (entry: CompanionLogEntry) => boolean): CompanionLogEntry | null {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = log[index];
    if (entry.role === 'kaylee' && matches(entry)) return entry;
  }
  return null;
}

/**
 * Used by this module's CompanionFab: what her face reads, derived from what the button already holds, so the button itself
 * stays a binding of the provider to the disc.
 *
 * THE SENTENCES. `playing` is the log entry matching the turn and index of the sentence this page's player is sounding
 * (`voice.speaking`): its mood word, its text and its sounds drive her mouth. `newest` is the newest entry of hers whose turn is
 * the running one (`picture.turnId`), the mood a page with no voice wears as her sentences arrive: it is read only where this page
 * plays none, because a page that plays her voice takes each mood as its sentence starts sounding and not as it arrives. A page plays
 * her voice when its switch is on and it holds the floor (`useCompanionVoice`). `turnRunning` is whether a turn is under way.
 *
 * THE LOOK is the anchor's centre less her own, in whole pixels, and it has two phases. While she glides to the anchor, hers is her REST
 * centre: she turns toward where she is going. Once she has landed, hers is her TARGET centre: she faces the thing beside her.
 */
export function useFaceInputs({ picture, voice, clientId, anchor, rest, target, size, landed }: FaceInputsArgs): {
  sentences: CompanionFaceSentences;
  look: CompanionFaceLook | null;
} {
  const log = picture?.log ?? NO_LOG;
  const turnId = picture?.turnId ?? null;
  const { speaking } = voice;
  const playsVoice = voice.on && picture !== null && picture.floor === clientId;

  const playing = useMemo(
    () => (speaking === null ? null : newestOfHers(log, (entry) => entry.turnId === speaking.turnId && entry.index === speaking.index)),
    [log, speaking],
  );
  const newest = useMemo(
    () => (playsVoice || turnId === null ? null : newestOfHers(log, (entry) => entry.turnId === turnId)),
    [log, playsVoice, turnId],
  );
  const turnRunning = turnId !== null;
  const sentences = useMemo(() => ({ playing, newest, turnRunning }), [playing, newest, turnRunning]);

  const look = useMemo(() => {
    if (anchor === null || target === null || rest === null) return null;
    const from = landed
      ? { x: target.left + size / 2, y: target.top + size / 2 }
      : { x: rest.x + rest.width / 2, y: rest.y + rest.height / 2 };
    return { dx: Math.round(anchor.left + anchor.width / 2 - from.x), dy: Math.round(anchor.top + anchor.height / 2 - from.y) };
  }, [anchor, target, rest, size, landed]);

  return { sentences, look };
}
