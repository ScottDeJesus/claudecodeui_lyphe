import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import type { AnimationEvent, KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DispatchArcDecks,
  endedHide,
  HiddenPlans,
  PlanCard,
  planHide,
  SessionPin,
} from '@/modules/dispatcher';
import type { DispatcherArcGroup, DispatcherArcSplit } from '@/modules/dispatcher';
import type { DispatcherPlan } from '@/shared/types';
import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** One page of the widget: a whole arc deck, or one plan no arc holds. */
type WidgetItem = { kind: 'arc'; group: DispatcherArcGroup } | { kind: 'plan'; plan: DispatcherPlan };

/** A page's identity across polls — `darc:` beside `plan:`, so an arc and a plan never share one. */
function itemKey(item: WidgetItem): string {
  return item.kind === 'arc' ? `darc:${item.group.arc.name}` : `plan:${item.plan.name}`;
}

/**
 * The lane as pages, the open chat's first. The base order is the tab's own — the arcs in the lane's
 * order, then the plans of no arc in `byArc`'s urgency order — and the pages holding a plan this chat
 * opened are lifted to the front of it, keeping that order among themselves. An arc holds the chat's
 * plan when ANY plan of it does: the deck is the page, and it pins that plan's row inside (`SessionPin`).
 */
function pagesOf(split: DispatcherArcSplit, sessionId: string | null): WidgetItem[] {
  const isMine = (plan: DispatcherPlan) => sessionId !== null && plan.session_app_id === sessionId;
  const holdsMine = (item: WidgetItem) => (item.kind === 'arc' ? item.group.plans.some(isMine) : isMine(item.plan));
  const pages: WidgetItem[] = [
    ...split.groups.map((group): WidgetItem => ({ kind: 'arc', group })),
    ...split.rest.map((plan): WidgetItem => ({ kind: 'plan', plan })),
  ];
  return [...pages.filter(holdsMine), ...pages.filter((item) => !holdsMine(item))];
}

/**
 * The chat gutter's Runner widget as a PAGER: one top-level item of the lane at a time — an arc's deck,
 * which pages its own plans in its own strip, or one plan of no arc as its card — under a row that reads
 * `‹ n of total ›`, with `Hide ended · N` at the row's end and `Hidden · N` under the card.
 *
 * ONE ITEM, BECAUSE THE GUTTER IS COMPANY. The column is a card wide beside a conversation that is still
 * the point; a stack of every card the lane carries made the widget a second transcript to scroll. One
 * page at a time keeps it a glance, and the open chat's own plans are page one (`pagesOf`).
 *
 * THE PAGE IS HELD BY KEY, NEVER BY INDEX. A poll re-sorts the lane — a plan finishing moves in urgency,
 * a new plan lands in front — and an index would slide the reader onto another card under their eyes.
 * The key survives that. When the key itself leaves the lane (the plan was hidden, dropped, or its arc
 * went), the view lands on the item now standing nearest the index it last stood at, and holds THAT
 * item's key from then on.
 *
 * A NEW PAGE MOUNTS AFRESH: the drawn item is keyed by the page's key, so a turn arrives on the page-in
 * motion (`PageArrival`) and a poll, which keeps the key, never replays it.
 *
 * THE ROW TURNS THREE WAYS: its two arrows (disabled at their ends), and Left/Right while the row, or a
 * control in it, has the keyboard (`tabIndex={0}`). A turn that disables the arrow holding the keyboard —
 * clicked, pressed with Enter, or turned with Left/Right while it is focused — hands the keyboard to the
 * row, which keeps turning, rather than dropping it to `<body>`.
 *
 * `data-widget-pager` (the row), `data-widget-prev`/`data-widget-next` (its arrows), `data-widget-viewing`
 * (the count) and `data-widget-item` (the drawn page, valued by its key) are the browser harness's handles.
 *
 * Used by `RunnerWidgetBody`, as the widget's whole list below the loose planner badges.
 */
export function WidgetPager({
  split,
  plans,
  hidden,
  carriedNames,
  sessionId,
}: {
  /** The lane split by arc (`byArc`): the pages, before the open chat's are lifted. */
  split: DispatcherArcSplit;
  /** The drawn plans, every page's — what `Hide ended · N` counts and hides. */
  plans: DispatcherPlan[];
  /** The lane's hidden plans, for the `Hidden · N` list under the card. */
  hidden: DispatcherPlan[];
  /** The lane's unfiltered plan names, which every hide prunes the hide store against. */
  carriedNames: string[];
  /** The open chat, whose plans are page one and wear its pin. */
  sessionId: string | null;
}) {
  const { t } = useTranslation();
  const pages = pagesOf(split, sessionId);
  // The page the reader is on, by its KEY, beside the index it stood at when last drawn. The key is what
  // holds the view: a poll re-orders the lane, and an index would slide onto another card. The index is
  // only where the view lands when that key leaves the lane. `key` is `null` until a page is drawn.
  const [view, setView] = useState<{ key: string | null; index: number }>({ key: null, index: 0 });
  const rowRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const found = view.key === null ? -1 : pages.findIndex((item) => itemKey(item) === view.key);
  const index = found !== -1 ? found : Math.max(0, Math.min(view.index, pages.length - 1));
  const page = pages[index];
  const pageKey = page === undefined ? null : itemKey(page);
  // Adopted during render, the house's way of holding what an earlier render landed on
  // (`useShapeCollapse`'s re-seed): an effect would paint one frame on a page the next poll could still
  // move. The same inputs land on the same page, so a render React discards changes nothing.
  if (pageKey !== null && (pageKey !== view.key || index !== view.index)) setView({ key: pageKey, index });

  const ended = endedHide(plans, carriedNames);
  const last = pages.length - 1;

  /**
   * Turn one page. A turn that reaches an end disables that end's arrow, and a focused button that is
   * disabled drops the keyboard to `<body>`. So the turn asks the DOCUMENT which arrow has the keyboard,
   * never its caller: a click, Enter, or Left/Right on a focused arrow all disable it the same way.
   */
  const turn = (delta: -1 | 1) => {
    const target = Math.max(0, Math.min(index + delta, last));
    const landed = pages[target];
    if (landed === undefined || target === index) return;
    const focused = document.activeElement;
    const disablesFocused = (target === 0 && focused === previousRef.current) || (target === last && focused === nextRef.current);
    setView({ key: itemKey(landed), index: target });
    if (disablesFocused) rowRef.current?.focus();
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    // Taken over: the page is the row's one axis, and the browser's own arrow would scroll the gutter.
    event.preventDefault();
    turn(event.key === 'ArrowLeft' ? -1 : 1);
  };

  // `Hide ended · N` takes itself away (nothing ended is left to hide), and a focused button that
  // unmounts drops the keyboard to `<body>`; the row stays, so the keyboard goes to it on the next frame.
  // A press that hid the whole lane takes the row too, and then the widget's `Hidden · N` is the heir.
  const hideEnded = (hide: () => void) => {
    const widget = rowRef.current?.closest<HTMLElement>('[data-runner-widget]') ?? null;
    hide();
    requestAnimationFrame(() => {
      const heir = rowRef.current?.isConnected ? rowRef.current : widget?.querySelector<HTMLElement>('[data-hidden-plans] button');
      heir?.focus();
    });
  };

  return (
    <>
      {page !== undefined && (
        <div className="flex min-w-0 flex-col gap-3">
          <div
            ref={rowRef}
            role="group"
            tabIndex={0}
            aria-label={t('dispatcher.pager.label')}
            onKeyDown={onRowKeyDown}
            data-widget-pager
            className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={t('dispatcher.pager.previous')}
              ref={previousRef}
              disabled={index === 0}
              onClick={() => turn(-1)}
              data-widget-prev
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            {/* Polite and live, so a turn is heard as where it landed. */}
            <p className="text-xs tabular-nums text-muted-foreground" aria-live="polite" data-widget-viewing>
              {t('dispatcher.pager.of', { n: index + 1, total: pages.length })}
            </p>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={t('dispatcher.pager.next')}
              ref={nextRef}
              disabled={index === last}
              onClick={() => turn(1)}
              data-widget-next
            >
              <ChevronRight aria-hidden="true" />
            </Button>
            {/* Every drawn plan that has finished, on every page, put away in ONE write — the tab
                header's own button (`RunnerPanel`). Not drawn when none has; no dialog: `Show all`
                undoes it. */}
            {ended && (
              <Button variant="secondary" size="sm" className="ml-auto h-8" onClick={() => hideEnded(ended.hide)} data-hide-ended>
                {t('dispatcher.hideEnded', { count: ended.count })}
              </Button>
            )}
          </div>
          <PageArrival key={itemKey(page)} pageKey={itemKey(page)}>
            {page.kind === 'arc' ? (
              <DispatchArcDecks groups={[page.group]} home="gutter" pinnedSessionId={sessionId} carriedNames={carriedNames} />
            ) : (
              <PlanPage plan={page.plan} mine={sessionId !== null && page.plan.session_app_id === sessionId} carriedNames={carriedNames} />
            )}
          </PageArrival>
        </div>
      )}
      <HiddenPlans hidden={hidden} carriedNames={carriedNames} />
    </>
  );
}

/** Whether `element` is running a CSS animation named `name` right now. */
function playing(element: Element, name: string): CSSAnimation | undefined {
  return element.getAnimations()
    .find((animation): animation is CSSAnimation => animation instanceof CSSAnimation && animation.animationName === name);
}

/**
 * One page's ARRIVAL: the page-in motion (`motion-safe:animate-shape-item`, Verve's `vv-pagein`) on the
 * page's wrapper, once per mount, keyed by the page so a turn mounts a new one.
 *
 * THE CLASS ENDS WITH ITS ANIMATION. The Chat tab — this widget's home — is hidden with `display: none`,
 * never unmounted (`WorkspaceMain`), and a CSS animation restarts whenever its element is shown again:
 * a class held for the mount replayed the arrival on every return to Chat. So "arriving" is state,
 * cleared on the wrapper's own `animationend` — the cure `useRiseOnce` applies to a card's rise.
 *
 * ONE ENTRANCE PER ARRIVAL. A page this page session has never drawn arrives with its root card or deck
 * already rising (`useRiseOnce`, its first sight), and the two motions stacked — both offsets added,
 * both fades multiplied. So when the wrapper's page-in starts over a root that is rising, the page-in
 * stands down on the spot and the rise is the arrival. Animation events are dispatched before the frame
 * paints, and the cancel is synchronous, so the cancelled page-in paints no first keyframe.
 *
 * Under `prefers-reduced-motion: reduce` the class is inert (`motion-safe:`): nothing runs, nothing ends,
 * and the class stays, doing nothing.
 */
function PageArrival({ pageKey, children }: { pageKey: string; children: ReactNode }) {
  // Whether this mount's page-in is still to play, or playing: set false once, when it ends or when the
  // page's own rise is found to be the arrival. Held as state so a re-displayed tab has nothing to restart.
  const [arriving, setArriving] = useState(true);

  const onAnimationStart = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.animationName !== 'vv-pagein') return;
    const root = event.currentTarget.querySelector('[data-dispatch-arc], [data-dispatcher-card]');
    if (root === null || playing(root, 'vv-rise') === undefined) return;
    playing(event.currentTarget, 'vv-pagein')?.cancel();
    setArriving(false);
  };
  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.animationName === 'vv-pagein') setArriving(false);
  };

  return (
    <div
      data-widget-item={pageKey}
      className={cn('min-w-0', arriving && 'motion-safe:animate-shape-item')}
      onAnimationStart={onAnimationStart}
      onAnimationEnd={onAnimationEnd}
    >
      {children}
    </div>
  );
}

/**
 * A plan of no arc as the widget's page: its card, wearing this chat's pin when the chat opened it — the
 * same pin a plan inside an arc deck wears on its own row, so "this chat opened that plan" reads the same
 * at either depth. `runner-widget-plan`, `data-plan-name` and `data-pinned` are the harness's handles.
 */
function PlanPage({ plan, mine, carriedNames }: { plan: DispatcherPlan; mine: boolean; carriedNames: string[] }) {
  return (
    <div data-testid="runner-widget-plan" data-plan-name={plan.name} data-pinned={String(mine)} className="flex min-w-0 flex-col gap-1">
      {mine && <SessionPin />}
      <PlanCard plan={plan} onHide={planHide(plan, carriedNames)} />
    </div>
  );
}
