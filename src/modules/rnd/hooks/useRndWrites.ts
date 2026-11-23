import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { operatorWords } from '@/modules/dispatcher';
import { readBody, sentenceOf } from '@/modules/rnd/rndWire';
import { SpikeRefusal, startSpikeChat } from '@/modules/rnd/startSpikeChat';
import { api } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { RndScoutsRun } from '@/shared/rnd-types';

/** The dispatcher's sentence for a press it refused, and where that press was made: 'scout', 'settings' or a candidate's name. */
export type RndRefusal = { where: string; sentence: string };

export type RndWrites = {
  /** The press that is out, by where it was made; null when none is. */
  busy: string | null;
  refusal: RndRefusal | null;
  dismiss: () => void;
  scoutNow: () => void;
  spike: (name: string, projectPath: string | null, sendMessage: (message: unknown) => void, goChat: (sessionId: string) => void) => void;
  adopt: (name: string, arc: string, goal: string | null) => void;
  reject: (name: string, why: string) => void;
  reopen: (name: string) => void;
  addSource: (url: string, label?: string | null) => void;
  removeSource: (url: string) => void;
  webSearch: (next: boolean) => void;
  scoutsRun: (next: RndScoutsRun) => void;
  /** A launch row's save, made from the settings sheet (useRndLaunch's save). */
  saveLaunch: (save: () => Promise<Response>) => void;
};

/**
 * Every press of the R&D place, one dispatcher rnd verb each over /api/rnd, and what to say about it.
 *
 * NOTHING IS OPTIMISTIC AND NOTHING HERE HOLDS THE PICTURE: a landed write pokes the lane, and the panel redraws from the rnd_state
 * frame that follows. A landed write's own line (the dispatcher's ADDED, SCOUT LAUNCHED, ADOPTED...) is a toast; a refused one is
 * the dispatcher's sentence, held as the refusal where the press was made, until he reads it or presses again.
 */
export function useRndWrites(): RndWrites {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<RndRefusal | null>(null);

  // A press that ends lets go of busy only if it still holds it: a later press made elsewhere keeps its own.
  const release = useCallback((where: string) => setBusy((current) => (current === where ? null : current)), []);

  const press = useCallback((where: string, act: () => Promise<Response>) => {
    setBusy(where);
    setRefusal(null);
    const run = async () => {
      try {
        const response = await act();
        const said = sentenceOf(await readBody(response));
        if (response.ok) {
          if (said !== '') toast({ tone: 'positive', title: said });
          return;
        }
        setRefusal({ where, sentence: operatorWords(said, [where]) || t('messages.operationFailed') });
      } catch (error) {
        console.warn('[useRndWrites] the press at ' + where + ' did not complete:', error);
        setRefusal({ where, sentence: t('messages.networkError') });
      } finally {
        release(where);
      }
    };
    void run();
  }, [t, toast, release]);

  const spike = useCallback<RndWrites['spike']>((name, projectPath, sendMessage, goChat) => {
    if (projectPath === null) {
      setRefusal({ where: name, sentence: t('rnd.spikeNoProject') });
      return;
    }
    setBusy(name);
    setRefusal(null);
    startSpikeChat(name, projectPath, sendMessage, goChat)
      .catch((error: unknown) => {
        if (error instanceof SpikeRefusal) {
          setRefusal({ where: name, sentence: error.message });
          return;
        }
        console.warn('[useRndWrites] the spike of ' + name + ' did not start:', error);
        setRefusal({ where: name, sentence: t('messages.networkError') });
      })
      .finally(() => release(name));
  }, [t, release]);

  return useMemo<RndWrites>(() => ({
    busy,
    refusal,
    dismiss: () => setRefusal(null),
    scoutNow: () => press('scout', () => api.rnd.scout()),
    spike,
    adopt: (name, arc, goal) => press(name, () => api.rnd.adopt(name, goal === null ? { arc } : { arc, goal })),
    reject: (name, why) => press(name, () => api.rnd.reject(name, { why })),
    reopen: (name) => press(name, () => api.rnd.reopen(name)),
    addSource: (url, label) => press('settings', () => api.rnd.addSource(label ? { url, label } : { url })),
    removeSource: (url) => press('settings', () => api.rnd.removeSource({ url })),
    webSearch: (next) => press('settings', () => api.rnd.settings({ webSearch: next })),
    scoutsRun: (next) => press('settings', () => api.rnd.settings({ scoutsRun: next })),
    saveLaunch: (save) => press('settings', save),
  }), [busy, refusal, press, spike]);
}
