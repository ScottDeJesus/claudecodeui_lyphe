import { PinIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Select } from '@/shared/ui';

/** The word the Default option carries in its list: the choice that clears a pin. */
const DEFAULT_CHOICE = 'default';

type AgentLaunchChoiceProps = {
  /** The caption over the control — Model or Effort. */
  label: string;
  /** The accessible name, which must say WHOSE model this is: a row's caption is a word, not a name. */
  ariaLabel: string;
  /** Every word the table accepts, from `census.choices`. */
  choices: string[];
  /** What the row resolves to now; null is a launch that passes no flag. */
  current: string | null;
  /** True when the row's own table entry set `current`; false when it came from the defaults. */
  pinned: boolean;
  /** What clearing the pin would resolve to, so the Default choice can say it. Null is no flag. */
  defaultWord: string | null;
  /** A word pins it; null clears the pin. */
  onChange: (next: string | null) => void;
};

/**
 * One of a row's two controls — its model or its effort — marked pinned or default, and changed in
 * place. Used by `AgentLaunchRowItem`, for every soul and for Metis.
 *
 * THE LIST IS THE TABLE'S OWN VOCABULARY plus one choice that is not a word: Default, which clears the
 * pin and says what it would fall back to. A row that is not pinned selects that choice, so the
 * control reads "Default · sonnet" and never shows a pin the table does not hold; a pinned row shows
 * its word and wears the pinned badge — the exceptions are what stands out down a list of twenty-two.
 *
 * THE CAPTION SITS BESIDE THE LIST on a panel narrower than 64rem and above it on a wider one. The
 * list's overlay is at least 14rem wide and opens rightwards from its trigger, so a phone's second
 * column of controls hung its overlay off the screen (measured at 390px); stacked, each list has the
 * width to open.
 */
export function AgentLaunchChoice({ label, ariaLabel, choices, current, pinned, defaultWord, onChange }: AgentLaunchChoiceProps) {
  const { t } = useTranslation();
  const noFlag = t('agentLaunch.row.noFlag');
  const options = [
    { value: DEFAULT_CHOICE, label: t('agentLaunch.row.defaultOf', { value: defaultWord ?? noFlag }) },
    ...choices.map((word) => ({ value: word, label: word })),
  ];

  return (
    <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 [@container(min-width:64rem)]:grid-cols-1 [@container(min-width:64rem)]:gap-y-1.5">
      <div className="flex flex-col items-start gap-1 [@container(min-width:64rem)]:h-5 [@container(min-width:64rem)]:flex-row [@container(min-width:64rem)]:items-center [@container(min-width:64rem)]:justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {pinned && (
          <Badge as="span" tone="info" className="vv-badge--compact gap-1">
            <PinIcon className="h-3 w-3" aria-hidden="true" />
            {t('agentLaunch.row.pinned')}
          </Badge>
        )}
      </div>
      <Select
        size="sm"
        ariaLabel={ariaLabel}
        options={options}
        value={pinned && current ? current : DEFAULT_CHOICE}
        onChange={(next) => onChange(next === DEFAULT_CHOICE ? null : next)}
      />
    </div>
  );
}
