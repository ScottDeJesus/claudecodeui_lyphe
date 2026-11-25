import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { GeminiKey } from '@/modules/gemini-spend/geminiFigures';
import { GeminiRow, GeminiRows } from '@/modules/gemini-spend/GeminiRow';
import type { ProcessRow } from '@/modules/gemini-spend/types';
import { Badge, Rule } from '@/shared/ui';

type GeminiKeysProps = {
  /** Every key either door listed, one row a key. */
  keys: GeminiKey[];
  /** The connector's processes, or null when that door did not answer: its place is the sentence higher up. */
  processes: ProcessRow[] | null;
};

/**
 * By key and by process: who is spending, under what was spent on. Every key by its last four characters and what holds
 * it, with its calls and dollars; a key that is held and was not counted in the window is marked so, and its row says nothing more.
 * Under the keys, the one sentence that says what the list is for. Beside them (under them on a narrow panel), the
 * connector's processes with theirs.
 */
export function GeminiKeys({ keys, processes }: GeminiKeysProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const holdersOf = (key: GeminiKey) => {
    const names = [...key.envNames, ...key.meterHolders.map((holder) => t('api.gemini.keys.holder.' + holder, { defaultValue: holder }))];
    return names.length > 0 ? t('api.gemini.keys.heldAs', { names: names.join(', ') }) : t('api.gemini.keys.noHolder');
  };

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby={headingId} data-gemini-section="keys">
      <Rule id={headingId}>{t('api.gemini.keys.title')}</Rule>
      <div className="grid min-w-0 items-start gap-6 [@container(min-width:56rem)]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3" data-gemini-keys>
          <Rule level={4} end={keys.length}>
            {t('api.gemini.keys.keys')}
          </Rule>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('api.gemini.keys.empty')}</p>
          ) : (
            <GeminiRows>
              {keys.map((key) => {
                const notCounted = key.calls === 0 && key.envNames.length + key.meterHolders.length > 0;
                return (
                  <GeminiRow
                    key={key.key}
                    name={t('api.gemini.keys.tail', { tail: key.key })}
                    mono
                    detail={holdersOf(key)}
                    marks={
                      notCounted && (
                        <Badge as="span" tone="neutral" className="text-xs" data-gemini-mark="not-counted">
                          <span aria-hidden="true">○</span>&nbsp;{t('api.gemini.keys.notCounted')}
                        </Badge>
                      )
                    }
                    calls={key.calls}
                    costUsd={key.cost_usd}
                    sayNoCalls={!notCounted}
                  />
                );
              })}
            </GeminiRows>
          )}
          <p className="text-xs text-muted-foreground" data-gemini-keys-what>
            {t('api.gemini.keys.what')}
          </p>
        </div>
        {processes !== null && (
          <div className="flex min-w-0 flex-col gap-3" data-gemini-processes>
            <Rule level={4} end={processes.length}>
              {t('api.gemini.keys.processes')}
            </Rule>
            {processes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('api.gemini.keys.noProcesses')}</p>
            ) : (
              <GeminiRows>
                {processes.map((row) => (
                  <GeminiRow key={row.process} name={row.process} mono calls={row.calls} costUsd={row.cost_usd} />
                ))}
              </GeminiRows>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
