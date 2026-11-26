import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RndLaunch, RndLaunchKind } from '@/modules/rnd/RndSettingsSheet';
import { isRecord, readBody, sentenceOf } from '@/modules/rnd/rndWire';
import { api } from '@/shared/api';
import type { AgentLaunchCensus, AgentLaunchRow, AgentLaunchRowChange } from '@/shared/agent-launch-types';

/** The launch table's row each of the place's launches runs at (charters/launch.toml, the one home of their model and effort). */
const ROW_OF: Record<RndLaunchKind, string> = { scout: 'rnd.scout', spike: 'rnd.spike', adopt: 'rnd.adopt' };

type CensusRead = { census: AgentLaunchCensus | null; failure: string | null };

/**
 * THE SCOUT'S, THE SPIKE'S AND ADOPT'S PLACER'S LAUNCH ROWS, as the settings sheet's slots. Read once from GET /api/agent-launch when the panel opens
 * and replaced by the census each save answers with; the sheet holds no copy of its own (INV-5703). save answers the response, so
 * useRndWrites says a refusal where the sheet is.
 */
export function useRndLaunch(): {
  launch: RndLaunch | null;
  launchFailure: string | null;
  save: (kind: RndLaunchKind, slot: 'model' | 'effort', next: string | null) => Promise<Response>;
} {
  const { t } = useTranslation();
  const [read, setRead] = useState<CensusRead>({ census: null, failure: null });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.agentLaunch.census();
        const body = await readBody(response);
        if (cancelled) return;
        if (!response.ok || !isCensus(body)) {
          setRead({ census: null, failure: sentenceOf(body) || t('messages.operationFailed') });
          return;
        }
        setRead({ census: body, failure: null });
      } catch (error) {
        if (cancelled) return;
        console.warn('[useRndLaunch] the launch table could not be read:', error);
        setRead({ census: null, failure: t('messages.networkError') });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const save = useCallback(async (kind: RndLaunchKind, slot: 'model' | 'effort', next: string | null) => {
    const change: AgentLaunchRowChange = slot === 'model' ? { model: next } : { effort: next };
    const response = await api.agentLaunch.saveRow(ROW_OF[kind], change);
    if (response.ok) {
      // A clone, so the caller still reads the answer's own body for what to say.
      const body = await readBody(response.clone());
      if (isCensus(body)) setRead({ census: body, failure: null });
    }
    return response;
  }, []);

  return useMemo(() => {
    const { census, failure } = read;
    if (census === null) return { launch: null, launchFailure: failure, save };
    const scout = census.rows.find((row) => row.name === ROW_OF.scout);
    const spike = census.rows.find((row) => row.name === ROW_OF.spike);
    const adopt = census.rows.find((row) => row.name === ROW_OF.adopt);
    if (scout === undefined || spike === undefined || adopt === undefined) return { launch: null, launchFailure: t('rnd.launchMissing'), save };
    return { launch: { scout: slotsOf(census, scout), spike: slotsOf(census, spike), adopt: slotsOf(census, adopt) }, launchFailure: null, save };
  }, [read, save, t]);
}

/** A row's two slots: the table's words, the one in force, whether the row pins it, and what clearing the pin falls back to. */
function slotsOf(census: AgentLaunchCensus, row: AgentLaunchRow): RndLaunch[RndLaunchKind] {
  return {
    model: { choices: census.choices.models, current: row.model, pinned: row.model_pinned, defaultWord: census.defaults.model },
    effort: { choices: census.choices.efforts, current: row.effort, pinned: row.effort_pinned, defaultWord: census.defaults.effort[row.model] ?? null },
  };
}

/** The census the relay carries untouched from launch-table show: refused only when it is not that document at all. */
function isCensus(value: unknown): value is AgentLaunchCensus {
  return isRecord(value) && Array.isArray(value.rows) && isRecord(value.choices) && isRecord(value.defaults);
}
