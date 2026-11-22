import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clockOf, epochOf } from '@/modules/dispatcher/dispatcherState';
import { FaceTrigger } from '@/modules/dispatcher/FaceTrigger';
import { Badge, Button, Collapsible, CollapsibleContent } from '@/shared/ui';
import type { DispatcherDecided, DispatcherDecidedBy, DispatcherGap, DispatcherPlan, Tone } from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * WHAT WAS DECIDED IN THE OPERATOR'S PLACE on one feature since he accepted it, and the gaps it
 * finished with that are still being healed. A walk never stops to ask: the builder takes the
 * default he can undo, a rule or the designer settles a dispute, and this list is where the operator
 * reads each of those choices afterwards, with the way to reverse it beside it.
 *
 * THE FOUR STATES:
 * - no decided row and no open gap: nothing is drawn, which is most cards, so the face stays as quiet
 *   as it was;
 * - decided rows: one fold, "Decided for you" with its count, in the face's own trigger. It starts
 *   OPEN when a row is newer than the operator's last look at this plan's list and closed otherwise,
 *   and a newer row wears "new" (as the trigger does, with their count, so a closed fold still says it);
 * - rows and gaps: the gaps stand UNDER the fold and outside it: directly under the trigger of a
 *   folded list, in sight without a press, and after the rows of an open one, whose trigger then
 *   says how many gaps are below in place of its count of new rows (each new row wears "new" itself
 *   while the list is open). The trigger carries one badge at a time and its title never breaks. A
 *   gap is the one thing here to watch, so it is never folded away with the settled choices;
 * - gaps and no row: the gaps alone.
 *
 * A ROW READS IN THE ORDER THE QUESTION WAS ANSWERED: who decided, when and for which task (the
 * title drops to a line of its own where the row is too narrow to hold it beside them), what was left
 * open, what was chosen, why, and how to undo it. The choice is the row's answer, so it is the one
 * line set in the card's body size and ink; the rest is the small muted line the card's captions use.
 * Newest first, five to an opened fold, so opening it costs about a screen and a half of a phone and
 * never the whole history; the rest stand behind one press, "Show N earlier", which raises the count
 * of rows drawn. Every line wraps, a long path breaks inside its word, and nothing here is cut with
 * an ellipsis: a choice half read is not read.
 * On a wide card both lists keep a reading measure instead of running the card's whole width.
 *
 * COLOUR SAYS A STATE AND NEVER WHO: the three deciders wear the same neutral badge and are told
 * apart by their word. "new" is info, a high gap is warn, a gap of any other rank is neutral and
 * wears its rank as written, and nothing here is red: a gap being healed is watched, not acted on.
 *
 * EVERY STRING REACHES THE DOM AS A TEXT NODE: a task's title, a choice, a reason and a gap's title
 * are free text souls wrote. The rows are mounted only while the fold is open, as the task list's are.
 *
 * Used by `PlanFace`, above its events fold.
 */

/** How many decided rows an opened fold draws until "Show N earlier" is pressed: the newest, newest first. A row is about 250px at phone width, so five is a screen and a half; the rest wait behind "Show N earlier". */
const ROW_LIMIT = 5;

/** The last look of an operator who has never opened this plan's list: every row is newer than it. */
const NEVER_LOOKED = 0;
/** Where this browser keeps a plan's last look, one key a plan: the prefix and the plan's name. */
const LAST_LOOK_KEY_PREFIX = 'dispatcher.decided.lastLook:';
/** What a plan from a dispatcher build older than the keys reads as. The client is served live (HMR) and may meet a server whose reader predates them, so an absent key draws nothing rather than throwing. */
const NO_DECIDED: readonly DispatcherDecided[] = [];
const NO_GAPS: readonly DispatcherGap[] = [];

/** Every word the list says, read through the locale under `dispatcher.decided.*`. */
function copyOf(t: ReturnType<typeof useTranslation>['t']) {
  return {
    title: t('dispatcher.decided.title'),
    fresh: t('dispatcher.decided.fresh'),
    freshCount: (count: number) => t('dispatcher.decided.freshCount', { count }),
    by: {
      builder: t('dispatcher.decided.by.builder'),
      designer: t('dispatcher.decided.by.designer'),
      rule: t('dispatcher.decided.by.rule'),
    } as Readonly<Record<DispatcherDecidedBy, string>>,
    wholeFeature: t('dispatcher.decided.wholeFeature'),
    what: t('dispatcher.decided.what'),
    choice: t('dispatcher.decided.choice'),
    why: t('dispatcher.decided.why'),
    undo: t('dispatcher.decided.undo'),
    earlier: (count: number) => t('dispatcher.decided.earlier', { count }),
    gaps: t('dispatcher.decided.gaps'),
    gapsBelow: (count: number) => t('dispatcher.decided.gapsBelow', { count }),
    priority: {
      high: t('dispatcher.decided.priority.high'),
      medium: t('dispatcher.decided.priority.medium'),
      low: t('dispatcher.decided.priority.low'),
    } as Readonly<Record<string, string | undefined>>,
    ticket: (ticket: number) => t('dispatcher.decided.ticket', { ticket }),
    ticketCopied: (ticket: number) => t('dispatcher.decided.ticketCopied', { ticket }),
    ticketNotCopied: (ticket: number) => t('dispatcher.decided.ticketNotCopied', { ticket }),
  };
}

/** A gap's tone by its priority: a high one is watched, any other rank is later. */
const gapTone = (priority: string): Tone => (priority === 'high' ? 'warn' : 'neutral');

/** Whether a row was decided after the operator last looked at this plan's list. */
function isFresh(row: DispatcherDecided, lastLook: number): boolean {
  return (epochOf(row.at) ?? 0) > lastLook;
}

export function PlanDecided({ plan }: { plan: DispatcherPlan }) {
  const { t } = useTranslation();
  const COPY = copyOf(t);
  const rows = plan.decided ?? NO_DECIDED;
  const gaps = plan.open_gaps ?? NO_GAPS;
  // Read once, when the card is drawn: a row stays "new" for as long as the operator is reading it.
  const [lastLook] = useState(() => lastLookOf(plan.name));
  const fresh = rows.filter((row) => isFresh(row, lastLook)).length;
  const [open, setOpen] = useState(fresh > 0);
  // Folding the list either way is the look. The newest row's own stamp is kept, never this browser's clock, so a skewed clock cannot hide a row.
  const onOpenChange = (next: boolean) => {
    rememberLook(plan.name, rows);
    setOpen(next);
  };
  // The bug board has no door that opens one ticket from outside it, so the press hands the operator the ticket's number to take there.
  const [copied, setCopied] = useState<{ ticket: number; ok: boolean } | null>(null);
  const onOpenTicket = (ticket: number) => {
    void copyTicket(ticket).then((ok) => setCopied({ ticket, ok }));
  };
  const [shownCount, setShownCount] = useState(ROW_LIMIT);
  // "Show N earlier" names every row still behind it, so the press draws them all.
  const onShowEarlier = () => setShownCount(rows.length);

  if (rows.length === 0 && gaps.length === 0) return null;
  const shown = rows.slice(-shownCount).reverse();
  const earlier = rows.length - shown.length;
  // An open list stands between its trigger and the gaps, so the trigger then says they are below, in place of its count of new rows.
  const gapsBelow = open && gaps.length > 0;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-plan-decided={plan.name}>
      {rows.length > 0 && (
        <Collapsible open={open} onOpenChange={onOpenChange} className="min-w-0" data-decided-fold>
          <FaceTrigger>
            <span className="whitespace-nowrap">{COPY.title} · {rows.length}</span>
            {fresh > 0 && !gapsBelow && <Badge as="span" tone="info" className="ml-1 flex-none" data-decided-fresh>{COPY.freshCount(fresh)}</Badge>}
            {gapsBelow && <Badge as="span" tone={gaps.some((gap) => gap.priority === 'high') ? 'warn' : 'neutral'} className="ml-1 flex-none" data-decided-gaps-below>{COPY.gapsBelow(gaps.length)}</Badge>}
          </FaceTrigger>
          <CollapsibleContent className="min-w-0">
            {open && (
              <ul className="flex min-w-0 max-w-3xl flex-col divide-y divide-border" aria-label={COPY.title}>
                {shown.map((row) => (
                  <li key={row.id} className="flex min-w-0 flex-col gap-1.5 px-2 py-2.5" data-decided-row={row.id} data-decided-by={row.by}>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge as="span" tone="neutral" className="flex-none">{COPY.by[row.by]}</Badge>
                      {isFresh(row, lastLook) && <Badge as="span" tone="info" className="flex-none">{COPY.fresh}</Badge>}
                      <span className="flex-none font-mono text-xs text-muted-foreground">{clockOf(row.at)}</span>
                      <span className="min-w-0 flex-1 basis-48 break-words text-xs">{row.task ?? COPY.wholeFeature}</span>
                    </div>
                    <dl className="flex min-w-0 flex-col gap-1">
                      <Said label={COPY.what}>{row.what}</Said>
                      <Said label={COPY.choice} answer>{row.choice}</Said>
                      <Said label={COPY.why}>{row.why}</Said>
                      <Said label={COPY.undo}>{row.undo}</Said>
                    </dl>
                  </li>
                ))}
                {earlier > 0 && (
                  <li className="px-0.5 py-1" data-decided-earlier>
                    <Button type="button" variant="ghost" size="sm" className="text-xs finger:min-h-11" onClick={onShowEarlier}>{COPY.earlier(earlier)}</Button>
                  </li>
                )}
              </ul>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      {gaps.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1" data-plan-gaps>
          <p className="px-2 text-xs font-medium text-muted-foreground">{COPY.gaps} · {gaps.length}</p>
          <ul className="flex min-w-0 max-w-3xl flex-col divide-y divide-border" aria-label={COPY.gaps}>
            {gaps.map((gap) => (
              <li key={gap.ticket} className="flex min-w-0 flex-col gap-1 px-2 py-2" data-plan-gap={gap.ticket}>
                <div className="flex min-w-0 items-baseline gap-2">
                  <Badge as="span" tone={gapTone(gap.priority)} className="flex-none">{COPY.priority[gap.priority] ?? gap.priority}</Badge>
                  <span className="min-w-0 flex-1 break-words text-sm leading-snug">{gap.title}</span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="min-w-0 flex-1 basis-32 break-words text-xs text-muted-foreground">{gap.task}</span>
                  <Button type="button" variant="ghost" size="sm" className="flex-none font-mono text-xs finger:min-h-11" onClick={() => onOpenTicket(gap.ticket)}>
                    {COPY.ticket(gap.ticket)}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {/* What the last ticket press did, said where the operator pressed: the copy is silent otherwise. */}
          <p className="px-2 text-xs text-muted-foreground" aria-live="polite" data-gap-ticket-copied>
            {copied === null ? '' : copied.ok ? COPY.ticketCopied(copied.ticket) : COPY.ticketNotCopied(copied.ticket)}
          </p>
        </div>
      )}
    </div>
  );
}

/** One labelled line of a decided row. The `answer` line is what was chosen: the row's one line in the body size and ink. */
function Said({ label, answer = false, children }: { label: string; answer?: boolean; children: string }) {
  return (
    <div className={cn('min-w-0 break-words', answer ? 'text-sm leading-snug' : 'text-xs text-muted-foreground')}>
      <dt className={cn('inline font-medium', answer && 'text-muted-foreground')}>{label}: </dt>
      <dd className="inline">{children}</dd>
    </div>
  );
}

/** The stamp of the newest row this plan's list was last folded over, or NEVER_LOOKED. Blocked storage or a stored value that is not a number reads as never looked, so every row shows as new: the list errs toward being read. */
function lastLookOf(plan: string): number {
  try {
    const stored = Number(window.localStorage.getItem(LAST_LOOK_KEY_PREFIX + plan) ?? NEVER_LOOKED);
    return Number.isFinite(stored) ? stored : NEVER_LOOKED;
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return NEVER_LOOKED;
  }
}

/** Keeps the newest row's stamp as this plan's last look. */
function rememberLook(plan: string, rows: readonly DispatcherDecided[]): void {
  const newest = rows.length > 0 ? epochOf(rows[rows.length - 1].at) : null;
  if (newest === null) return;
  try {
    window.localStorage.setItem(LAST_LOOK_KEY_PREFIX + plan, String(newest));
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    console.warn(`PlanDecided: the last look at ${plan} was not kept, storage refused it`, error);
  }
}

/** Puts a gap's ticket number on the clipboard and answers whether it landed. A page with no clipboard (plain http off localhost) or a refused write answers false and leaves the cause in the console, naming the ticket. */
async function copyTicket(ticket: number): Promise<boolean> {
  if (!navigator.clipboard) {
    console.warn(`PlanDecided: no clipboard on this page to copy ticket ${ticket}`);
    return false;
  }
  try {
    await navigator.clipboard.writeText(String(ticket));
    return true;
  } catch (error: unknown) {
    console.warn(`PlanDecided: ticket ${ticket} could not be copied`, error);
    return false;
  }
}
