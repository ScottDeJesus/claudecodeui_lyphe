import { useContext } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AppWindow,
  ChartColumn,
  ChevronDownIcon,
  CircleCheckBig,
  Clock,
  CodeXml,
  FileDiff,
  Gauge,
  Gavel,
  GitCompareArrows,
  Info,
  LayoutPanelTop,
  List,
  ListChecks,
  Rows3,
  Scale,
  Table2,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { Tone } from '@/shared/types';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { ChipsSuppressedContext } from '@/modules/chat/transcript/shapes/chipContext';
import { LeadInTitleContext } from '@/modules/chat/transcript/shapes/leadInContext';
import { useShapeCollapse } from '@/modules/chat/transcript/shapes/useShapeCollapse';

/**
 * Every `data-shape` kind a frame draws, and the whole list of them.
 *
 * Defined here, unexported, because this file is its only user: every caller passes a string
 * literal, so no second module ever names the type. A kind added to a shape without a line here is
 * a type error at the call site, which is the point.
 */
type ShapeKind =
  | 'table' | 'data-bars' | 'decision-matrix' | 'before-after' | 'callout' | 'tasks' | 'checks'
  | 'timeline' | 'facts' | 'verdict' | 'stats' | 'diff' | 'tabbed-code' | 'diagram'
  | 'list' | 'widget' | 'docspace';

/**
 * The icon and the tone every kind wears, so one shape's frame says what it is before a word is
 * read. `accent` is not a sixth tone: it is the ABSENCE of a tone, the structural pair
 * (`bg-primary/[0.06]` wash, `text-accent-ink` ink) that a card of pure structure wears.
 *
 * A structural kind takes the accent; only the three kinds that carry a verdict — a callout, a
 * verdict banner and a check list — take a meaning tone, and their callers override it when the
 * meaning is the caller's to know (`Callout`'s alert kind, `CheckResults`' fail count). Every icon
 * name was confirmed to exist in the installed `lucide-react`.
 */
const SHAPE_KINDS: Record<ShapeKind, { icon: LucideIcon; tone: Tone | 'accent' }> = {
  table: { icon: Table2, tone: 'accent' },
  'data-bars': { icon: ChartColumn, tone: 'accent' },
  'decision-matrix': { icon: Scale, tone: 'accent' },
  'before-after': { icon: GitCompareArrows, tone: 'accent' },
  callout: { icon: Info, tone: 'info' },
  tasks: { icon: ListChecks, tone: 'accent' },
  checks: { icon: CircleCheckBig, tone: 'positive' },
  timeline: { icon: Clock, tone: 'accent' },
  facts: { icon: Rows3, tone: 'accent' },
  verdict: { icon: Gavel, tone: 'positive' },
  stats: { icon: Gauge, tone: 'accent' },
  diff: { icon: FileDiff, tone: 'accent' },
  'tabbed-code': { icon: CodeXml, tone: 'accent' },
  diagram: { icon: Workflow, tone: 'accent' },
  list: { icon: List, tone: 'accent' },
  widget: { icon: AppWindow, tone: 'accent' },
  docspace: { icon: LayoutPanelTop, tone: 'accent' },
};

type ShapeFrameProps = {
  /** The `data-shape` kind: `table`, `callout`, `verdict`, … — the probes' measuring surface. */
  kind: ShapeKind;
  /**
   * The header's words, for every frame that names its own. A `ReactNode` rather than a string
   * because a lead-in title is the author's own rendered paragraph: `**Summary**` keeps its bold,
   * `` `src/parser.ts:42` `` keeps its span.
   *
   * Absent only on the frame `LeadIn` draws for a list, which takes its words — and whether they
   * hold a link — from `LeadInTitleContext` instead, so the title has ONE source per render.
   */
  title?: ReactNode;
  /** From `shapeKey(kind, payload)`; the payload each kind uses is fixed by the plan's table. */
  collapseKey: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The registry's tone for the kind, when the caller knows better: `Callout`'s alert kind, `VerdictBanner`'s verdict, `CheckResults`' fail count. */
  tone?: Tone;
  /** The registry's icon for the kind, when the caller knows better: `Callout`, per alert kind. */
  icon?: LucideIcon;
  /**
   * True for a frame drawn AROUND plain prose rather than around a shape of its own — `LeadIn`'s
   * list card, and nothing else. The root then keeps `not-prose` off, so the chat's own card rules
   * reach the list inside it, and the body zeroes the container's first and last margins because
   * this frame, not the prose container, is what holds the block.
   */
  prose?: boolean;
  /** True for a frame whose own content reaches its own edge — `EmbedFrame`'s live iframe, and nothing else. The body then drops its inset. */
  flush?: boolean;
};

/**
 * The header's words, in whichever arm drew them.
 *
 * Local to this file and used twice below — inside the fold toggle and, on an export, where the
 * toggle is not drawn at all. It carries `data-shape-title` so a probe can read the header a render
 * actually produced, and it wraps its content in `ChipsSuppressedContext.Provider`: a title is a
 * label, so a code span in it gets no chip and no picture, the same answer `PlainHeading` and
 * `PlainTableHeaderCell` give their own labels. A lead-in title is the author's rendered paragraph,
 * so the span carries no text-overflow utility: an ellipsised `**Summary**`, or a path cut mid-name,
 * would be rendering less than the markdown it replaced.
 */
function TitleSpan({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span data-shape-title className={className}>
      <ChipsSuppressedContext.Provider value={true}>{children}</ChipsSuppressedContext.Provider>
    </span>
  );
}

/**
 * The one header bar every shape wears.
 *
 * Used by every shape under `shapes/`. It is BUILT ON the shared `Collapsible` primitive rather
 * than on a div and a button: that primitive already exists with its grid-rows animation and
 * already has two consumers, and a hand-rolled disclosure here would be this repo's fourth
 * spelling of open-and-shut — the third of which, `CollapsibleSection`, is where the export rule
 * already lives, which is precisely the evidence that spelling it again gets that rule wrong.
 *
 * It adds exactly four things the primitive does not have: the markers a verify script queries to
 * prove a shape painted — `data-shape`, `data-collapsed`, `data-text-scale` and, only on a card the
 * reader has not watched arrive, `data-vv-enter` on the root,
 * `data-shape-toggle` on the trigger, and `data-shape-header` / `data-shape-icon` /
 * `data-shape-title` / `data-shape-actions` / `data-shape-body` on the regions below it — the
 * content-addressed fold memory through `useShapeCollapse`, the `actions` slot's placement, and the
 * header anatomy itself: icon, then title, sized in `em` so a frame follows the chat text size.
 *
 * The tone sits on the HEADER ROW and never on the root, so a Badge or a Chip in the body keeps its
 * own tone instead of inheriting the frame's — which is the whole reason `data-tone` is written
 * there and nowhere else.
 */
export function ShapeFrame({ kind, title, collapseKey, actions, children, className, tone, icon, prose, flush }: ShapeFrameProps) {
  const { t } = useTranslation('chat');
  const { collapsed, toggle, interactive, enter } = useShapeCollapse(collapseKey);
  // A lead-in's words win over the caller's own label: this frame IS the block below a paragraph, and
  // the paragraph is the header the reader wrote. Provided by `LeadIn`, and `null` everywhere else.
  const leadIn = useContext(LeadInTitleContext);
  const effectiveTitle = leadIn?.title ?? title;
  // A lead-in line may hold a link, and the title sits inside the fold's button. `ShapeSection`
  // names the hazard for a heading — an anchor inside a button is two controls in one — and this is
  // the same answer: the chevron alone becomes the button and the words are drawn beside it.
  const titleHasLink = leadIn?.hasLink ?? false;
  const toggleLabel = collapsed ? t('shapes.expand') : t('shapes.collapse');
  // The caller's word beats the registry's when it has one: the same `callout` kind is five alert
  // kinds, and only `Callout` can see which. `accent` is the absence of a tone, and is the only
  // value that writes no `data-tone`.
  const effectiveTone = tone ?? SHAPE_KINDS[kind].tone;
  const accent = effectiveTone === 'accent';
  const HeaderIcon = icon ?? SHAPE_KINDS[kind].icon;
  const chevron = (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn(
        'h-[1em] w-[1em] flex-shrink-0 transition-transform duration-200',
        collapsed && '-rotate-90'
      )}
    />
  );
  // Sized in `em`, never px or rem: the icon, the chevron, the title and the body all follow the
  // chat text size the reader set, which is the one thing the prose around a frame already does.
  const iconGlyph = (
    <HeaderIcon
      aria-hidden="true"
      data-shape-icon
      className={cn('h-[1.125em] w-[1.125em] shrink-0', accent ? 'text-accent-ink' : 'text-[color:var(--tone-ink)]')}
    />
  );
  // A header is never smaller than what it heads, so the title takes the body size and carries the
  // hierarchy on its weight and the header's wash instead. `truncate` is absent: a lead-in title is
  // the author's own line, it wraps under itself, and it is never cut.
  const titleClass = cn('min-w-0 flex-1 break-words font-semibold', accent ? 'text-foreground' : 'text-[color:var(--tone-ink)]');
  const triggerClass = 'min-w-0 select-none text-left transition-colors hover:text-foreground';

  return (
    <div
      data-shape={kind}
      data-collapsed={String(collapsed)}
      data-text-scale="flow"
      data-vv-enter={enter ? '' : undefined}
      className={cn(
        'my-3 overflow-hidden rounded-xl border border-border bg-card/50 shadow-sm',
        !prose && 'not-prose',
        className
      )}
    >
      <Collapsible open={!collapsed} onOpenChange={toggle}>
        <div
          data-shape-header
          data-tone={accent ? undefined : effectiveTone}
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-md-body text-muted-foreground',
            accent ? 'bg-primary/[0.06]' : 'bg-[color:var(--tone-soft)]'
          )}
        >
          {interactive && !titleHasLink ? (
            <CollapsibleTrigger
              data-shape-toggle
              title={toggleLabel}
              className={cn(triggerClass, 'flex flex-1 items-center gap-1.5')}
            >
              {chevron}
              {iconGlyph}
              <TitleSpan className={titleClass}>{effectiveTitle}</TitleSpan>
            </CollapsibleTrigger>
          ) : (
            <>
              {/* The chevron alone is the button here, for the two cases where the words cannot be
                  in it: a lead-in title holding a link, and an export, which has nothing to click
                  and so draws no toggle at all rather than a dead one. `useShapeCollapse` has
                  already forced `collapsed` false on an export, so the body is whole. */}
              {interactive ? (
                <CollapsibleTrigger
                  data-shape-toggle
                  aria-label={toggleLabel}
                  title={toggleLabel}
                  className={cn(triggerClass, 'flex flex-shrink-0 items-center')}
                >
                  {chevron}
                </CollapsibleTrigger>
              ) : null}
              {iconGlyph}
              <TitleSpan className={titleClass}>{effectiveTitle}</TitleSpan>
            </>
          )}
          {actions ? (
            <span data-shape-actions className="flex flex-shrink-0 items-center gap-1 text-md-meta">{actions}</span>
          ) : null}
        </div>
        <CollapsibleContent>
          {/* The body re-provides a null title: a frame nested under a titled one — a list inside a
              section, a shape inside a callout — must wear its OWN label, never the block's above it. */}
          <LeadInTitleContext.Provider value={null}>
            <div
              data-shape-body
              className={cn(
                'border-t border-border/70 text-md-body text-foreground',
                !flush && 'px-3 py-2',
                prose && '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
              )}
            >
              {children}
            </div>
          </LeadInTitleContext.Provider>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
