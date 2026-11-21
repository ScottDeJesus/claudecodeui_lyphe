import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CodeModeCause, CodeModeFaultTotals, CodeModeKind } from '@/shared/analytics-types';
import { Button, Collapsible, CollapsibleContent, CollapsibleTrigger, FoldChevron, Rule } from '@/shared/ui';
import { restOf } from '@/modules/analytics/sections/code-mode/codeModeFigures';

/**
 * WHAT WENT WRONG: the failures of the window as families, the commonest first. The heading carries how many there
 * were in all, in the warn ink while there are any, and the line under it says the same in a sentence.
 *
 * A FAMILY IS A ROW THAT OPENS. Closed, it says what failed (the fault in the locale's word for it, as the two parts
 * above say it, or the raw kind for one the verb adds later; then the helper it was in and the rule that spoke, the
 * journals' own, in the mono face), how often, in how many launches and of which kinds. Open, it shows the sentences
 * it was most often said in, each with its count, and how many more were worded another way. The first family is open on
 * arrival: the commonest cause is what the reader came for, and one open row shows what a row holds.
 *
 * The sentences are the journals' own and are drawn as they came, in the mono face, wrapped, never cut.
 *
 * THE FIRST EIGHT FAMILIES ARE DRAWN and the rest are one press away under them: at 90 days the tail is ones and twos,
 * and twenty-five rows stood between the reader and the days.
 *
 * NOTHING FAILED is a sentence, and no heading figure. The verb lists 25 families at most; what falls outside them is
 * said in a last line once every family is drawn, so the rows then add up to the heading.
 */

type CodeModeCausesProps = {
  /** The families, ranked by count, 25 at most. */
  causes: CodeModeCause[];
  /** Every fault in the window. */
  faults: CodeModeFaultTotals;
  /** The kinds the verb counts: a family names its kinds by their labels. */
  kinds: CodeModeKind[];
};

/** How many families are drawn on arrival; the rest are one press away. */
const FIRST_FAMILIES = 8;

/** One family: the row, and under it its commonest sentences. */
function CauseFamily({ cause, kinds, startsOpen }: { cause: CodeModeCause; kinds: string; startsOpen: boolean }) {
  const { t } = useTranslation('common');
  // FILL: onFamilyToggle — open or closed, held here for the visit.
  const [open, setOpen] = useState(startsOpen);
  const rest = restOf(cause.count, cause.top);
  const launches = t('analytics.codeMode.causes.inLaunches', { count: cause.launches });

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-start gap-2 py-2.5 text-left finger:min-h-11">
          <span className="mt-0.5 flex-none text-muted-foreground">
            <FoldChevron collapsed={!open} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground">
              <span className="font-medium">{t('analytics.codeMode.causes.fault.' + cause.fault, { defaultValue: cause.fault })}</span>
              {cause.helper !== '' && <span className="font-mono text-xs">{cause.helper}</span>}
              {cause.hook !== '' && <span className="break-all font-mono text-xs text-muted-foreground">{cause.hook}</span>}
            </span>
            <span className="text-xs text-muted-foreground">
              {cause.threw > 0
                ? t('analytics.codeMode.causes.where', { launches, ended: t('analytics.codeMode.causes.endedScript', { count: cause.threw }), kinds })
                : t('analytics.codeMode.causes.whereQuiet', { launches, kinds })}
            </span>
          </span>
          <span className="flex-none text-sm font-medium tabular-nums text-foreground">{cause.count.toLocaleString()}</span>
        </CollapsibleTrigger>
        <CollapsibleContent aria-hidden={!open}>
          <ul className="flex flex-col gap-2 pb-3 pl-6">
            {cause.top.map((sentence) => (
              <li key={sentence.cause} className="flex items-start gap-3 text-xs">
                <span className="min-w-0 flex-1 break-words font-mono text-muted-foreground">{sentence.cause}</span>
                <span className="flex-none tabular-nums text-foreground">{t('analytics.codeMode.causes.times', { times: sentence.count.toLocaleString() })}</span>
              </li>
            ))}
            {rest > 0 && <li className="text-xs text-muted-foreground">{t('analytics.codeMode.causes.otherWords', { count: rest })}</li>}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

/** Rendered by CodeModeSection, third. Nothing else mounts it. */
export function CodeModeCauses({ causes, faults, kinds }: CodeModeCausesProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const labelOf = (kind: string) => kinds.find((entry) => entry.kind === kind)?.label ?? kind;
  const unlisted = restOf(faults.total, causes);
  const listId = useId();
  // FILL: onShowAll — the first families only, or every one; the first on arrival, held here for the visit.
  const [allShown, setAllShown] = useState(false);
  const shown = allShown ? causes : causes.slice(0, FIRST_FAMILIES);

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-code-mode-causes>
      <Rule id={headingId} end={faults.total > 0 ? faults.total.toLocaleString() : undefined} endTone="warn">
        {t('analytics.codeMode.causes.title')}
      </Rule>

      {faults.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('analytics.codeMode.causes.none')}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t('analytics.codeMode.causes.head', { count: faults.total })}</p>
          <ol id={listId} className="flex flex-col divide-y divide-border">
            {shown.map((cause, at) => (
              <CauseFamily
                key={JSON.stringify([cause.fault, cause.helper, cause.hook])}
                cause={cause}
                kinds={cause.kinds.map(labelOf).join(t('analytics.codeMode.listSeparator'))}
                startsOpen={at === 0}
              />
            ))}
          </ol>
          {causes.length > FIRST_FAMILIES && (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 self-start text-muted-foreground finger:h-11"
              aria-expanded={allShown}
              aria-controls={listId}
              onClick={() => setAllShown((all) => !all)}
            >
              <FoldChevron collapsed={!allShown} />
              {allShown
                ? t('analytics.codeMode.causes.showFirst', { count: FIRST_FAMILIES })
                : t('analytics.codeMode.causes.showRest', { count: causes.length - FIRST_FAMILIES })}
            </Button>
          )}
          {unlisted > 0 && shown.length === causes.length && <p className="text-xs text-muted-foreground">{t('analytics.codeMode.causes.unlisted', { count: unlisted })}</p>}
        </>
      )}
    </section>
  );
}
