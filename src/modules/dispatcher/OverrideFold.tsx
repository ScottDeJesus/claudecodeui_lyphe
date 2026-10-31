import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CardFoldBody, Collapsible, CollapsibleTrigger, FoldChevron } from '@/shared/ui';

/**
 * THE FOLD EVERY CARD'S OWN CONTROLS LIVE IN. The master controller at the top of In flight is the one place
 * the house is steered from; what a card carries of its own — an epic's model, a feature's model — is an
 * OVERRIDE of that, and it sits folded away under the card's verbs, CLOSED BY
 * DEFAULT, composed from the kit's fold (`Collapsible` and `CardFoldBody`, the same fold the cards' own
 * heads draw; never a hand-built disclosure).
 *
 * THE FOLDED LINE NAMES EVERY OVERRIDE THE FOLD HOLDS and nothing more when it holds none: `overrides` is the
 * list of words the caller read off the card (`DeepSeek`, `Default`), drawn after the label; an
 * empty list draws the label alone. A glance at a closed card therefore says whether anything under it
 * departs from the top, without opening it. Inside, every dropdown's first option follows the top and any other
 * option is an override (`ModelPick`).
 *
 * The whole line presses it, and its chevron is the card fold's own glyph (`FoldChevron`), turned by the
 * trigger's `data-state` so there is no state of this component's own to disagree with the fold's. The closed body is
 * `inert` and `aria-hidden` (`CardFoldBody`), so none of its dropdowns is reachable from the keyboard while the
 * fold is shut.
 *
 * Handles: `data-override-fold` on the group, valued with the scope (`plan` or `dispatch-arc`), beside the
 * fold's own `data-state` (`open` | `closed`); the summary line is `data-override-summary`.
 *
 * Used by `DispatchArcControls` (an epic's fold) and `PlanControls` (a feature's).
 */
export function OverrideFold({ scope, overrides, children }: { scope: 'plan' | 'dispatch-arc'; overrides: string[]; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Collapsible className="flex w-full min-w-0 flex-col" data-override-fold={scope}>
      <CollapsibleTrigger
        className="group flex min-h-8 finger:min-h-11 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FoldChevron collapsed={false} className="group-data-[state=closed]:-rotate-90" />
        <span className="flex-none font-semibold">{t('dispatcher.fold.label')}</span>
        {overrides.length > 0 && (
          <span className="min-w-0 truncate font-medium text-foreground" data-override-summary>
            {overrides.join(' · ')}
          </span>
        )}
      </CollapsibleTrigger>
      <CardFoldBody>
        {/* The body's gap lives on this wrapper, never on `CardFoldBody`: that slot is a GRID whose row goes
            1fr → 0fr, so a `flex`/`gap` passed to it would be overridden by its own `grid`. */}
        <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 px-1 pb-1 pt-2">{children}</div>
      </CardFoldBody>
    </Collapsible>
  );
}
