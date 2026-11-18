import { useMemo } from 'react';

import type { CompanionLogEntry, CompanionPicture } from '@/shared/companion-types';
import type { CompanionFaceSentences, CompanionVoice } from '@/shared/types';

type FaceSentencesArgs = {
  /** Her picture: the log her sentences are read from, the running turn's id and the floor. Null until the first read. */
  picture: CompanionPicture | null;
  /** This page's voice: `speaking` is the sentence its player is sounding, and `on` its switch. */
  voice: CompanionVoice;
  /** This page's name for her, to know whether it holds the floor and so plays her voice. */
  clientId: string;
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
 * Used by this module's CompanionFace, which is her face bound to the provider wherever it is drawn (the sessions home, the station):
 * the sentences her face reads, derived from the picture and the page's voice.
 *
 * `playing` is the log entry matching the turn and index of the sentence this page's player is sounding (`voice.speaking`): its mood
 * word, its text and its sounds drive her mouth. `newest` is the newest entry of hers whose turn is the running one
 * (`picture.turnId`), the mood a page with no voice wears as her sentences arrive: it is read only where this page plays none, because
 * a page that plays her voice takes each mood as its sentence starts sounding and not as it arrives. A page plays her voice when its
 * switch is on and it holds the floor (`useCompanionVoice`). `turnRunning` is whether a turn is under way.
 */
export function useFaceSentences({ picture, voice, clientId }: FaceSentencesArgs): CompanionFaceSentences {
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
  return useMemo(() => ({ playing, newest, turnRunning }), [playing, newest, turnRunning]);
}
