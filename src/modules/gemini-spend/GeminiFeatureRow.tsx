import { useTranslation } from 'react-i18next';

import { countWords } from '@/modules/gemini-spend/geminiFigures';
import { GeminiRow } from '@/modules/gemini-spend/GeminiRow';
import type { FeatureRow } from '@/modules/gemini-spend/types';
import { Badge, Switch } from '@/shared/ui';

type GeminiFeatureRowProps = {
  row: FeatureRow;
  /** The switch's press is out: it is held where it stood until the door reads back. */
  held: boolean;
  onSwitch: (enabled: boolean) => void;
};

/**
 * One feature of either door: its label, its marks, its calls, tokens and estimated dollars, and its switch.
 * A mark is a glyph and a word on a toned Badge: Off in the quiet tone (a choice, not a fault); unmeasured and unpriced
 * in the watch tone, because each means the dollars beside it are short of what was spent.
 */
export function GeminiFeatureRow({ row, held, onSwitch }: GeminiFeatureRowProps) {
  const { t } = useTranslation();
  return (
    <GeminiRow
      name={row.label}
      marks={
        <>
          {!row.enabled && (
            <Badge as="span" tone="neutral" className="text-xs" data-gemini-mark="off">
              <span aria-hidden="true">○</span>&nbsp;{t('api.gemini.row.off')}
            </Badge>
          )}
          {row.unmeasured_calls > 0 && (
            <Badge as="span" tone="warn" className="text-xs" data-gemini-mark="unmeasured">
              <span aria-hidden="true">▲</span>&nbsp;{t('api.gemini.row.unmeasured', { calls: countWords(row.unmeasured_calls) })}
            </Badge>
          )}
          {row.cost_usd === null && row.calls > 0 && (
            <Badge as="span" tone="warn" className="text-xs" data-gemini-mark="unpriced">
              <span aria-hidden="true">▲</span>&nbsp;{t('api.gemini.row.unpriced')}
            </Badge>
          )}
        </>
      }
      calls={row.calls}
      tokens={row.input_tokens + row.output_tokens}
      costUsd={row.cost_usd}
      end={<Switch checked={row.enabled} disabled={held} label={t('api.gemini.row.switch', { label: row.label })} onChange={onSwitch} />}
    />
  );
}
