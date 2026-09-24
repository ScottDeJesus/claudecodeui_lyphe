import { RunControls } from '@/modules/plan-runner/RunControls';
import { RunClock, RunFace, RunStateBadge } from '@/modules/plan-runner/RunFace';
import { runOutcomeWord } from '@/modules/plan-runner/runState';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/shared/ui';
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
 * `data-runner-card`, `data-run-id` and `data-run-state` are the browser harness's handles, and
 * they are on the ROOT so a probe can scope every reading to one run — the operator's own runs are
 * on screen at the same time and must never be acted on. `phase-25.mjs` asserts their ABSENCE from
 * the chat view; the Runner tab's probe is what reads them on a card.
 *
 * Used by `RunnerPanel` (the tab, every card open) and `RunnerWidgetBody` (the chat gutter, every
 * card folded) — for the runs no arc card owns; a run an arc card owns is drawn there instead.
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
  const ended = run.state === 'ended';

  return (
    <Card
      className="w-full min-w-0"
      data-runner-card
      data-run-id={run.run_id}
      data-run-state={run.state}
      data-run-outcome={ended ? runOutcomeWord(run) : undefined}
    >
      <CardHeader className="gap-2 p-3 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-0">
        <RunFace run={run} defaultOpen={defaultOpen} />
      </CardContent>

      <CardFooter className="p-3 pt-0">
        <RunControls run={run} onDismiss={onDismiss} />
      </CardFooter>
    </Card>
  );
}
