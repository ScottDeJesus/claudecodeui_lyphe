import { useTranslation } from 'react-i18next';

import { groupOf } from '@/modules/cerberus/fleet/fleetModel';
import { ServiceRow } from '@/modules/cerberus/fleet/ServiceRow';
import { StatusGlyph, StatusSquare } from '@/modules/cerberus/StatusMarks';
import { nodeMark, STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { isRestarting, nodeLine, serviceSentence, wardenLine } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusNodeView } from '@/shared/cerberus-types';
import type { CerberusCellShape, CerberusSheetTarget, FleetItem, FleetStatus } from '@/shared/types';
import { EmptyState, FoldChevron } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** A collapsed card shows this many service squares, then "+N". */
const SQUARES_SHOWN = 8;

/**
 * A collapsed card's edge, by its status's cell shape in the one table: refused and failing draw a
 * firm edge in their tone, close to the limit a fine one, no reading a dashed one, the rest the plain
 * border. A node with no mark (nothing assigned) is dashed too: there is nothing on it to read.
 */
const TILE_EDGE: Record<CerberusCellShape, string> = {
  solid: 'border-[1.5px] border-tone-dot',
  outline: 'border border-tone-dot',
  dashed: 'border-[1.5px] border-dashed border-input',
  soft: 'border border-border',
  flat: 'border border-border',
  surface: 'border border-border',
};
const UNMARKED_EDGE = 'border-[1.5px] border-dashed border-input';

/**
 * The node's round glyph from the table, or an empty dashed round when its word has no mark.
 *
 * Used by this card and by the rings' `RingsNodePanel`, which heads a selected node with the glyph its
 * card wears.
 */
export function NodeGlyph({ status, size }: { status: FleetStatus; size: 'sm' | 'md' }) {
  const mark = nodeMark(status);
  if (mark === null) {
    return <span aria-hidden className={cn('flex-none rounded-full border border-dashed border-input', size === 'sm' ? 'size-5' : 'size-6')} />;
  }
  return <StatusGlyph status={mark} size={size} />;
}

/**
 * The warden's heartbeat: the positive dot breathing while the node reports, the neutral dot still
 * while it is silent, restarting for an update, or not yet heard. Given a `name` (its warden line) it
 * is an image a reader can hover and hear, where no line beside it says the same; without one it is
 * decoration.
 *
 * Used by this card and by the rings' `RingsNodePanel`, beside a selected node's warden line.
 */
export function Heartbeat({ node, name }: { node: CerberusNodeView; name?: string }) {
  const alive = node.link === 'reporting' && !isRestarting(node);
  return (
    <span
      data-tone={alive ? 'positive' : 'neutral'}
      {...(name === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name, title: name })}
      className={cn('block size-1.5 flex-none rounded-full bg-tone-dot', alive && 'motion-safe:animate-cerberus-breathe')}
    />
  );
}

/** A collapsed node's services as squares, each named by its sentence; "+N" past eight; a dashed square for none. */
function ServiceSquares({ node }: { node: CerberusNodeView }) {
  const { t } = useTranslation();
  if (node.services.length === 0) {
    return <span aria-hidden className="block size-2.5 rounded-[3px] border border-dashed border-input" />;
  }
  const hidden = node.services.length - SQUARES_SHOWN;
  return (
    <>
      {node.services.slice(0, SQUARES_SHOWN).map((service) => (
        <StatusSquare
          key={service.service}
          status={service.status}
          label={t('cerberus.node.squareTip', { label: service.label ?? service.service, text: serviceSentence(t, service) })}
        />
      ))}
      {hidden > 0 && <span className="text-[10.5px] text-muted-foreground">{t('cerberus.node.moreSquares', { count: hidden })}</span>}
    </>
  );
}

type NodeCardProps = {
  item: FleetItem;
  /** The overview's own node: its warden, its services and their minutes, which the item leaves behind. */
  node: CerberusNodeView;
  open: boolean;
  /** `grid` is a tile that opens to a card across the grid; `list` is a row that opens to a band under it. */
  face: 'grid' | 'list';
  /** Its place on the page. The entrance waits 18 ms a place, up to the 24th, so a page rises in a wave. */
  index: number;
  /** The tab is narrow: a list row has no room for its warden line, which moves into its open band. */
  narrow?: boolean;
  /** The read's own moment, which the warden line's age is told against. */
  now: number;
  onToggle: (id: string, open: boolean) => void;
  onOpenCell: (target: CerberusSheetTarget) => void;
};

/** The entrance's wait per place on the page, and the last place that waits longer than the one before. */
const STAGGER_MS = 18;
const STAGGER_PLACES = 24;

/**
 * ONE NODE OF THE FLEET, in Grid or in List. Its root is the grid's cell or the list's row, so it
 * carries the page's entrance: a rise, later by a place for each node before it.
 *
 * Collapsed, it is the glyph of its worst word, its name, the warden's heartbeat, a square per
 * service and one line ("docstore — refused", "All 2 services passing", "Waiting for the first
 * heartbeat"). A press opens it.
 *
 * Open, it is the chevron, the name and description, and the warden line ("Warden 0.4.2 · heard 3 s
 * ago", "Warden 0.4.2 · restarting", "Warden 0.4.1 · silent since 17:41", "Waiting for the first
 * heartbeat", or for the hub, "Cerberus · this server"); then a `ServiceRow` per service, or "Nothing to
 * watch yet" when it has none ("Waiting to hear from it" before its first heartbeat). In Grid it spans
 * the grid and lifts off it, and an empty node draws the kit's `EmptyState`; in List it opens a canvas
 * band under its row, where an empty node is one sentence at the band's indent, as the list's rows are.
 *
 * Every mark is the one table's: the glyph, the squares, and the tile's edge by its cell shape.
 * `fixing` and `enrolling` are words the fixes and updates plans feed. Until then no node reads either,
 * and each draws as a node with no mark.
 *
 * Used by Fleet's `FleetGrid` and `FleetList`, once per node of the page.
 */
export function NodeCard({ item, node, open, face, index, narrow = false, now, onToggle, onOpenCell }: NodeCardProps) {
  const { t } = useTranslation();
  const mark = nodeMark(item.status);
  const tone = mark === null ? undefined : STATUS_TABLE[mark].tone;
  const line = nodeLine(t, item, node);
  const warden = wardenLine(t, node, now);
  // The words that ask for a look: needs you, and no result. Their line is written in their tone's ink.
  const loud = groupOf(item.status) === 'needs' || item.status === 'unknown';
  const entrance = { animationDelay: `${Math.min(index, STAGGER_PLACES) * STAGGER_MS}ms` };

  const waiting = node.link === 'never';
  const emptyMessage = waiting ? t('cerberus.node.waitingMessage') : t('cerberus.node.emptyMessage', { node: node.id });
  const services =
    node.services.length === 0 ? (
      face === 'grid' ? (
        <div className="px-4 pb-4">
          <EmptyState title={waiting ? t('cerberus.node.waitingTitle') : t('cerberus.node.emptyTitle')} message={emptyMessage} />
        </div>
      ) : (
        <p className="py-3 pl-[clamp(16px,10cqi,60px)] pr-4 text-[13px] text-muted-foreground">
          <span className="font-medium text-secondary-foreground">{waiting ? t('cerberus.node.waitingLead') : t('cerberus.node.emptyLead')}</span>{' '}
          {emptyMessage}
        </p>
      )
    ) : (
      node.services.map((service) => (
        <ServiceRow key={service.service} node={node.id} service={service} face={face} onOpenCell={onOpenCell} />
      ))
    );

  if (face === 'list') {
    // A row says each thing once: before its first heartbeat a node's line and its warden line are the
    // same sentence, and the row keeps the line.
    const ownWardenLine = warden !== line;
    return (
      <div className="border-t border-border first:border-t-0 motion-safe:animate-shape-rise" style={entrance}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => onToggle(item.id, !open)}
          className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-1.5 px-4 py-2.5 text-left transition-colors duration-quick hover:bg-background"
        >
          <span className="w-2.5 flex-none text-[9px] text-ink-faint">
            <FoldChevron collapsed={!open} />
          </span>
          <NodeGlyph status={item.status} size="sm" />
          <span className="flex min-w-[110px] flex-[0_1_210px] items-baseline gap-2 overflow-hidden">
            <span className="whitespace-nowrap text-sm font-medium">{item.id}</span>
            {item.desc !== null && <span className="truncate text-xs text-muted-foreground">{item.desc}</span>}
          </span>
          <span className="flex w-24 flex-none items-center gap-[3px]">
            <ServiceSquares node={node} />
          </span>
          <span data-tone={loud ? tone : undefined} className={cn('min-w-0 flex-[1_1_200px] truncate text-[13px]', loud ? 'text-tone-ink' : 'text-muted-foreground')}>
            {line}
          </span>
          {/* SLOT: updating — the updates plan's "Updating · <step>" pill (info, `vv-pulse`) stands here, before the warden line. */}
          {!narrow && ownWardenLine && (
            <span className="inline-flex flex-none items-center gap-[7px] text-xs text-muted-foreground">
              <Heartbeat node={node} />
              {warden}
            </span>
          )}
        </button>
        {open && (
          <div className="border-t border-border bg-background motion-safe:animate-shape-rise">
            {narrow && ownWardenLine && (
              <div className="flex items-center gap-[7px] px-4 py-2 text-xs text-muted-foreground">
                <Heartbeat node={node} />
                {warden}
              </div>
            )}
            {services}
            {/* SLOT: projects — the sessions plan's `NodeProjects` ("Projects that run here", "Run a project here") follows a co-located node's services. */}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('min-w-0 motion-safe:animate-shape-rise', open && 'col-span-full')} style={entrance}>
      {open ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-md motion-safe:animate-[vv-pop_.45s_theme(transitionTimingFunction.enter)_both]">
          <button
            type="button"
            aria-expanded
            onClick={() => onToggle(item.id, false)}
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors duration-quick hover:bg-background"
          >
            <span className="w-2.5 flex-none text-[10px] text-ink-faint">
              <FoldChevron collapsed={false} />
            </span>
            <NodeGlyph status={item.status} size="md" />
            <span className="text-base font-bold tracking-[-0.01em]">{item.id}</span>
            {item.desc !== null && <span className="text-[13px] text-muted-foreground">{item.desc}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
              {/* SLOT: updating — the updates plan's "Updating · <step>" pill (info, `vv-pulse`) stands here, before the warden line. */}
              <span className="inline-flex items-center gap-[7px]">
                <Heartbeat node={node} />
                {warden}
              </span>
            </span>
          </button>
          {services}
          {/* SLOT: projects — the sessions plan's `NodeProjects` ("Projects that run here", "Run a project here") follows a co-located node's services. */}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={false}
          title={line}
          onClick={() => onToggle(item.id, true)}
          data-tone={tone}
          className={cn(
            'flex size-full min-w-0 flex-col gap-2 rounded-xl bg-card px-3 py-2.5 text-left',
            'transition-[transform,box-shadow] duration-[400ms] ease-enter hover:-translate-y-1 hover:shadow-md active:scale-[.96] motion-reduce:transform-none',
            mark === null ? UNMARKED_EDGE : TILE_EDGE[STATUS_TABLE[mark].cell],
          )}
        >
          <span className="flex w-full min-w-0 items-center gap-2">
            <NodeGlyph status={item.status} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{item.id}</span>
            <Heartbeat node={node} name={warden} />
          </span>
          <span className="flex min-h-2.5 items-center gap-[3px]">
            <ServiceSquares node={node} />
          </span>
          <span className="w-full truncate text-xs text-muted-foreground">{line}</span>
        </button>
      )}
    </div>
  );
}
