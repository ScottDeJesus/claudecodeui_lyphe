import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, errorMessage } from '@/shared/api';
import type { RoadmapCase, RoadmapCases } from '@/shared/roadmap-types';

/** What the dialog's Cases section reads: the list, whether a read is out, and why the latest one failed (else null). */
type FeatureCasesRead = { cases: RoadmapCase[]; loading: boolean; failure: string | null };

/** One read's outcome: the list it answered, or the words that say why it did not (exactly one is set). */
type CasesAnswer = { cases: RoadmapCase[]; failure: null } | { cases: null; failure: string };

/** The latest answer, held with the feature and the counts it was asked for, so a read the counts have moved past is known to be one. */
type HeldAnswer = { name: string; key: string; cases: RoadmapCase[]; failure: string | null };

/** One empty list, so a dialog with nothing read hands its section the same array every render. */
const NO_CASES: RoadmapCase[] = [];

/** What a closed dialog, or a feature that keeps no case, reads: nothing, and nothing out. */
const NOTHING_READ: FeatureCasesRead = { cases: NO_CASES, loading: false, failure: null };

/**
 * How long a failed read waits before its one retry. The door answers in well under a second, so a
 * failure is usually a moment's (the door busy, a stopped command), and four seconds lets that pass
 * without a quiet roadmap's polled picture, which sends no frame, ever giving the read a second chance.
 */
const RETRY_AFTER_MS = 4000;

/**
 * Asks the cases route for one feature's list. It never rejects: a read that did not complete, or that
 * the route refused, comes back as the failure's WORDS. A refusal's own sentence names the door's
 * command and the feature's slug, which is developer speech and a slug off the Name-for-Claude line
 * (INV-6394), so it goes to the console and the screen says "the dispatcher did not answer"; a request
 * that never completed is the network's word.
 */
async function askForCases(name: string, t: TFunction): Promise<CasesAnswer> {
  let response: Response;
  try {
    response = await api.roadmap.cases(name);
  } catch (error) {
    console.warn(`[useFeatureCases] the cases request for ${name} did not complete:`, error);
    return { cases: null, failure: t('messages.networkError') };
  }
  const body = (await response.json().catch(() => null)) as { cases?: unknown; error?: unknown } | null;
  if (!response.ok) {
    console.warn(`[useFeatureCases] the cases route refused ${name} (${response.status}):`, errorMessage(body?.error) ?? '(no sentence)');
    return { cases: null, failure: t('roadmap.cases.unanswered') };
  }
  // A 200 without a list is not an answer this screen can draw; the route promises `{ cases }`.
  if (!Array.isArray(body?.cases)) return { cases: null, failure: t('messages.operationFailed') };
  return { cases: body.cases as RoadmapCase[], failure: null };
}

/**
 * The reads out right now, by the feature and counts they were asked for. A read asked for a key that
 * already has one out shares it, so the route is asked ONCE: StrictMode mounts an effect, cleans it up and
 * mounts it again (on every open, under the dev client), and without this the second mount sent a second
 * request for the answer the first was already fetching. An entry lives only while its read is out; a
 * dialog opened again after it landed reads afresh.
 */
const READS_OUT = new Map<string, Promise<CasesAnswer>>();

/** `askForCases`, shared by every caller that asks for the same `key` while it is out. */
function readOnce(key: string, name: string, t: TFunction): Promise<CasesAnswer> {
  const out = READS_OUT.get(key);
  if (out !== undefined) return out;
  const read = askForCases(name, t).finally(() => READS_OUT.delete(key));
  READS_OUT.set(key, read);
  return read;
}

/**
 * A feature dialog's cases: read from the cases route as the dialog opens, never on the polled picture
 * (a case is a sentence, a few paths and its newest run, which the picture's poll would carry for every
 * feature). `counts` is the feature's `cases` off the live picture, or null while the picture has not
 * placed the feature; it is read two ways. A feature that keeps no case (null, or a total of 0) reads
 * nothing, which is also all a closed dialog reads, since the hook lives only inside the open one. And the
 * read is asked AGAIN only when one of the six counts differs BY VALUE from those the last read answered
 * for (every frame hands a new object, changed or not, so the object is never the key): a case that breaks
 * while the dialog is open is never still listed as holding beside a row that says "1 broken".
 *
 * A re-read keeps the last list while it is out, so a poll never blinks the section; only the FIRST read,
 * with no list yet, is `loading` with nothing to show. A failed read keeps the last list and says why in
 * `failure`, which the section draws in the list's place, and is retried ONCE after `RETRY_AFTER_MS`
 * (without it a transient failure would stand until the dialog was reopened, since the counts a quiet
 * roadmap polls never move); a second failure stands. A read superseded by a newer one is dropped, and
 * its retry never fires, so the section never shows an answer the counts have already moved past.
 *
 * Used by the roadmap module's `FeatureDialog`, which hands the three values to `FeatureCases`.
 */
export function useFeatureCases(name: string, counts: RoadmapCases | null): FeatureCasesRead {
  const { t } = useTranslation();
  // The latest read's answer and the feature and counts it was asked for. It is the one thing a read can
  // only deliver after it lands; whether a read is OUT is not state, it is this key falling behind `wanted`.
  const [held, setHeld] = useState<HeldAnswer | null>(null);

  const wanted = counts === null || counts.total === 0
    ? null
    : [name, counts.total, counts.holding, counts.broken, counts.regressed, counts.not_run, counts.cant_run].join(':');

  useEffect(() => {
    if (wanted === null) return undefined;
    // A newer `wanted` (or an unmount) makes this read stale before it lands: its answer is dropped.
    let superseded = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const land = (answer: CasesAnswer) => {
      // A failed read keeps the list the feature last had (the section draws the failure over it).
      setHeld((last) => ({
        name,
        key: wanted,
        cases: answer.cases ?? (last?.name === name ? last.cases : NO_CASES),
        failure: answer.failure,
      }));
    };
    void readOnce(wanted, name, t).then((answer) => {
      if (superseded) return;
      land(answer);
      if (answer.failure === null) return;
      // The one retry: it keeps the failure on screen while it is out, and a failure of its own stands.
      retryTimer = setTimeout(() => {
        void readOnce(wanted, name, t).then((again) => {
          if (!superseded) land(again);
        });
      }, RETRY_AFTER_MS);
    });
    return () => {
      superseded = true;
      clearTimeout(retryTimer);
    };
  }, [name, wanted, t]);

  if (wanted === null) return NOTHING_READ;
  // An answer held for another feature is no answer for this one.
  const kept = held !== null && held.name === name ? held : null;
  return {
    cases: kept?.cases ?? NO_CASES,
    loading: kept === null || kept.key !== wanted,
    failure: kept?.failure ?? null,
  };
}
