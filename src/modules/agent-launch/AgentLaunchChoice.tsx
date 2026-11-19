import { PinIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Select } from '@/shared/ui';

/** The word the Default option carries in its list: the choice that clears a pin. */
const DEFAULT_CHOICE = 'default';

/** A slot that is a list: the row's word, changed in place. */
type AgentLaunchChoiceList = {
  said?: undefined;
  /** The accessible name, which must say WHOSE model this is: a row's caption is a word, not a name. */
  ariaLabel: string;
  /** Every word the table accepts for this slot, from `census.choices`. */
  choices: string[];
  /** What the row resolves to now; null is a launch that passes no flag. */
  current: string | null;
  /** True when the row's own table entry set `current`; false when it came from the defaults. */
  pinned: boolean;
  /** What clearing the pin would resolve to, so the Default choice can say it. Null is no flag. */
  defaultWord: string | null;
  /**
   * True for a word that always stands in the table and cannot be cleared (the sorter's two, the tweak's model): the list is
   * `choices` alone, with no Default, and it wears no pinned mark, because a word every such row carries is not an exception.
   */
  required?: boolean;
  /** A word pins it; null clears the pin. A required slot never hands null. */
  onChange: (next: string | null) => void;
};

/** A slot that is words: what the row launches at here and why there is nothing to choose. */
type AgentLaunchChoiceSaid = {
  /** The sentence the slot holds in place of a list. */
  said: string;
};

type AgentLaunchChoiceProps = {
  /** The caption over the slot — Model or Effort. */
  label: string;
} & (AgentLaunchChoiceList | AgentLaunchChoiceSaid);

/**
 * One of a row's two slots — its model or its effort — marked pinned or default, and changed in
 * place. Used by `AgentLaunchRowItem`, for every soul, for Metis, and for the sorter and the tweak.
 *
 * THE LIST IS THE TABLE'S OWN VOCABULARY plus one choice that is not a word: Default, which clears the
 * pin and says what it would fall back to. A row that is not pinned selects that choice, so the
 * control reads "Default · sonnet" and never shows a pin the table does not hold; a pinned row shows
 * its word and wears the pinned badge — the exceptions are what stands out down a list of twenty-two.
 *
 * A REQUIRED SLOT HAS NO DEFAULT TO OFFER. The sorter's and the tweak's words always stand in the table, so
 * their lists are the vocabulary alone and choosing the word already in force writes nothing.
 *
 * A SLOT WITH NOTHING TO CHOOSE SAYS SO WHERE THE LIST WOULD BE (`said`): the tweak's effort is its model's
 * default or Hephaestus's own pin, and a hole beside the Model list would read as a control that failed to load. The words stand at
 * the list's own height, so the two slots of a row share a baseline, under a finger too.
 *
 * THE CAPTION SITS BESIDE THE LIST on a panel narrower than 64rem and above it on a wider one. The
 * list's overlay is at least 14rem wide and opens rightwards from its trigger, so a phone's second
 * column of controls hung its overlay off the screen (measured at 390px); stacked, each list has the
 * width to open.
 */
export function AgentLaunchChoice(props: AgentLaunchChoiceProps) {
  const { t } = useTranslation();
  const { label } = props;
  const listed = props.said === undefined ? props : null;
  const noFlag = t('agentLaunch.row.noFlag');
  const words = listed === null ? [] : listed.choices.map((word) => ({ value: word, label: word }));
  const options =
    listed === null || listed.required
      ? words
      : [{ value: DEFAULT_CHOICE, label: t('agentLaunch.row.defaultOf', { value: listed.defaultWord ?? noFlag }) }, ...words];

  return (
    <div className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 [@container(min-width:64rem)]:grid-cols-1 [@container(min-width:64rem)]:gap-y-1.5">
      <div className="flex flex-col items-start gap-1 [@container(min-width:64rem)]:h-5 [@container(min-width:64rem)]:flex-row [@container(min-width:64rem)]:items-center [@container(min-width:64rem)]:justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        {listed !== null && !listed.required && listed.pinned && (
          <Badge as="span" tone="info" className="vv-badge--compact gap-1">
            <PinIcon className="h-3 w-3" aria-hidden="true" />
            {t('agentLaunch.row.pinned')}
          </Badge>
        )}
      </div>
      {listed === null ? (
        <p className="flex min-h-9 items-center text-pretty text-xs text-muted-foreground finger:min-h-11" data-agent-choice-said>
          {props.said}
        </p>
      ) : listed.required ? (
        <Select
          size="sm"
          ariaLabel={listed.ariaLabel}
          options={options}
          value={listed.current ?? ''}
          onChange={(next) => next !== listed.current && listed.onChange(next)}
        />
      ) : (
        <Select
          size="sm"
          ariaLabel={listed.ariaLabel}
          options={options}
          value={listed.pinned && listed.current ? listed.current : DEFAULT_CHOICE}
          onChange={(next) => listed.onChange(next === DEFAULT_CHOICE ? null : next)}
        />
      )}
    </div>
  );
}
