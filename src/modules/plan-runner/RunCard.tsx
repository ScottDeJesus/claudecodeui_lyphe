import { useTranslation } from 'react-i18next';

import { RunControls } from '@/modules/plan-runner/RunControls';
import { RunClock, RunFace, RunStateBadge } from '@/modules/plan-runner/RunFace';
import { PHASE_GLYPH, runOutcomeWord } from '@/modules/plan-runner/runState';
import { runFoldKey, useCardFold } from '@/shared/hooks/useCardFold';
import { Badge, Card, CardContent, CardFoldBody, CardFoldToggle, CardFooter, CardHeader, CardTitle, Collapsible } from '@/shared/ui';
import type { RunnerRunSnapshot } from '@/shared/types';

/** The last path segment of the plan the run walks — `cloudcli-docspace-embed.plan.md` — or the whole string when it has no slash. */
function planFileName(planPath: string): string {
  const cut = planPath.lastIndexOf('/');
  return cut === -1 ? planPath : planPath.slice(cut + 1);
}

/**
 * One plan-runner run, whole: the plan's name, then everything `RunFace` draws of it, in a card.
 *
 * IT COMPOSES AND DOES NOT DRAW, and what it composes with is the run's own display, shared with
 * the arc deck's plan cards (`RunFace`): the same word, the same clock, the same meter, the same
 * strip and the same verbs, so a run cannot read one way in this list and another way inside an
 * arc. What is HERE and only here is the FRAME — the card, the plan's file name and its H1 — which
 * a plan card of an arc does not want, because there the card's own title is the plan's name.
 *
 * THE PLAN FILE IS THE NAME (operator, 2026-09-10): it is what `/execute` was given, what
 * `plan-runner status` prints and what the ship logs are filed under, so it is the one name every
 * surface shares. The plan's own H1 sits beneath it as the description.
 *
 * THE CARD FOLDS, and that is the OUTER fold: the header row stays and the body — the meter, the
 * strip, the lanes and the phases — and the footer's verbs go with the fold. `defaultOpen` is a
 * different thing one level in, and untouched by this: it is whether the run's PHASE LIST starts
 * unfolded, which is the run card's own variance between the tab and the gutter.
 *
 * A FOLDED RUN THAT NEEDS A HAND STILL SAYS SO. The blocked mark travels with the run's phase list
 * inside `RunFace` when the card is open, and a folded card that dropped it would show a ⛔ as the
 * header's word alone — or, worse, as nothing at all — so the badge is drawn in the HEADER while the
 * card is folded, and only then. Drawing it in both states would put the same ⛔ on the card twice.
 *
 * THE BODY GOES WITH `CardFoldBody`, NOT `CollapsibleContent`: it is the same clip, and while the
 * card is closed it also carries `inert` + `aria-hidden`, so the footer's Resume and Dismiss and the
 * model switch are not merely painted 0px — they leave the tab order and the accessibility tree with
 * the pixels. The body is still the same DOM node either way. See `CardFold.tsx`.
 *
 * `data-runner-card`, `data-run-id`, `data-run-state` and `data-collapsed` are the browser
 * harness's handles, and they are on the ROOT so a probe can scope every reading to one run — the
 * operator's own runs are on screen at the same time and must never be acted on. `phase-25.mjs`
 * asserts their ABSENCE from the chat view; the Runner tab's probe is what reads them on a card.
 *
 * Used by `RunnerPanel` (the tab, every card open) and `RunnerWidgetBody` (the chat gutter, every
 * card folded in its phase list) — for the runs no arc card owns; a run an arc card owns is drawn
 * there instead.
 */
export function RunCard({
  run,
  defaultOpen,
  onDismiss,
}: {
  run: RunnerRunSnapshot;
  defaultOpen: boolean;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const ended = run.state === 'ended';
  const { collapsed, toggle } = useCardFold(runFoldKey(run.run_id));
  const blocked = run.phases.some((phase) => phase.state === 'blocked');

  return (
    <Card
      className="w-full min-w-0"
      data-runner-card
      data-run-id={run.run_id}
      data-run-state={run.state}
      data-run-outcome={ended ? runOutcomeWord(run) : undefined}
      data-collapsed={String(collapsed)}
    >
      <Collapsible open={!collapsed} onOpenChange={toggle}>
        <CardHeader className="gap-2 p-3 pb-2">
          {/* The row wraps: the title and the description take a full line each, and the word, the
              clock and the fold sit on the line after them. The fold is OUTSIDE the wrapping box so a
              long plan name cannot push it off the card's edge. */}
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <CardTitle className="w-full min-w-0 break-words font-mono text-sm leading-snug">
                {planFileName(run.plan_path)}
              </CardTitle>
              {run.plan_title && (
                // Three lines at most: a plan H1 on this host runs to 370 characters, and the file name above is the
                // title that must always read whole. The clamp clips the box only — the whole text stays in the
                // DOM and the accessibility tree.
                <p className="line-clamp-3 w-full min-w-0 break-words text-xs leading-snug text-muted-foreground">
                  {run.plan_title}
                </p>
              )}
              <RunStateBadge run={run} />
              <RunClock run={run} />
              {collapsed && blocked && (
                <Badge tone="warn">{`${PHASE_GLYPH.blocked} ${t('runner.phase.blocked')}`}</Badge>
              )}
            </div>
            <CardFoldToggle />
          </div>
        </CardHeader>

        <CardFoldBody>
          <CardContent className="p-3 pt-0">
            <RunFace run={run} defaultOpen={defaultOpen} />
          </CardContent>

          <CardFooter className="p-3 pt-0">
            <RunControls run={run} onDismiss={onDismiss} />
          </CardFooter>
        </CardFoldBody>
      </Collapsible>
    </Card>
  );
}
