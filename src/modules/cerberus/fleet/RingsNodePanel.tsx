import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { groupOf } from '@/modules/cerberus/fleet/fleetModel';
import { Heartbeat, NodeGlyph } from '@/modules/cerberus/fleet/NodeCard';
import { NodeProjects } from '@/modules/cerberus/fleet/NodeProjects';
import { ServiceRow } from '@/modules/cerberus/fleet/ServiceRow';
import { markLook, nodeMark } from '@/modules/cerberus/utils/cerberusStatus';
import { nodeLine, sessionsTail, wardenLine } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusNodeView } from '@/shared/cerberus-types';
import type { CerberusSheetTarget, FleetItem } from '@/shared/types';
import { Button, Card } from '@/shared/ui';
import { cn } from '@/shared/utils';

type RingsNodePanelProps = {
  item: FleetItem;
  /** The overview's own node: its warden, its services and their minutes, which the item leaves behind. */
  node: CerberusNodeView;
  /** The read's own moment, which the warden line's age is told against. */
  now: number;
  /** ✕: the rings let the node go, and the key comes back. */
  onClose: () => void;
  /** Opens the check sheet from a service row's name or one of its minutes, as an open card does in Grid. */
  onOpenCell: (target: CerberusSheetTarget) => void;
};

/**
 * THE SELECTED NODE, beside the rings: the node's open card, as this layout draws it.
 *
 * Its head is the glyph of its worst word, its name and description, its one line ("docstore — refused",
 * in its tone's ink when it asks for a look), and ✕. Under the head comes the warden line beside its
 * heartbeat: "Warden 0.4.1 · silent since 17:41", or "Cerberus · this server" for the hub; a reporting
 * warden that hosts chats ends it " · 2 sessions running here". Before a node's
 * first heartbeat that line is the node's own line, so it is said once, in the head. Then come its
 * services, one `ServiceRow` each, the rows its card opens to in Grid. A row's name opens the sheet at
 * now, and a minute opens it at that minute. A node with nothing to watch says so in one sentence. A node
 * that runs on this machine, or holds a project, ends with `NodeProjects`, "Projects that run here", as its
 * card does in Grid.
 *
 * It rises with `vv-pop`. The rings key it by node, so each new selection rises again.
 *
 * Used by Fleet's `FleetRings`, for the node or the hub its rings have selected.
 */
export function RingsNodePanel({ item, node, now, onClose, onOpenCell }: RingsNodePanelProps) {
  const { t } = useTranslation();
  const mark = nodeMark(item.status);
  const tone = mark === null ? undefined : markLook(mark).tone;
  // The words that ask for a look, needs you and no result, write the line in their tone's ink, as a card does.
  const inked = tone !== undefined && (groupOf(item.status) === 'needs' || item.status === 'unknown');
  const line = nodeLine(t, item, node);
  const warden = wardenLine(t, node, now);
  // " · N sessions running here", drawn after the warden line.
  const sessionsCount = sessionsTail(t, node);
  const waiting = node.link === 'never';
  // Where focus goes when a node's last project moves back and its section is gone: the panel's own close.
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <Card className="overflow-hidden shadow-md motion-safe:animate-[vv-pop_.45s_theme(transitionTimingFunction.enter)_both]">
      <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-3.5">
        <NodeGlyph status={item.status} size="md" />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2">
            <span className="flex-none text-base font-bold tracking-[-0.01em]">{item.id}</span>
            {item.desc !== null && <span className="truncate text-[13px] text-muted-foreground">{item.desc}</span>}
          </p>
          <p data-tone={inked ? tone : undefined} className={cn('text-[12.5px]', inked ? 'text-tone-ink' : 'text-muted-foreground')}>
            {line}
          </p>
        </div>
        {/* The library's icon Button: 40 px at a desk and 44 below md, Verve's touch minimum. The negative margin keeps the
            ✕ glyph where the old 28 px one stood, so the head's row does not grow. */}
        <Button
          ref={closeRef}
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t('buttons.close')}
          className="-mr-1.5 flex-none text-muted-foreground max-md:h-11 max-md:w-11"
        >
          <span aria-hidden>✕</span>
        </Button>
      </div>
      {warden !== line && (
        <p className="flex items-center gap-[7px] px-4 pb-3 text-xs text-muted-foreground">
          <Heartbeat node={node} />
          {warden}
          {sessionsCount}
        </p>
      )}
      {node.services.length === 0 ? (
        <p className="border-t border-border px-4 pb-3.5 pt-3 text-[13px] text-muted-foreground">
          <span className="font-medium text-secondary-foreground">{waiting ? t('cerberus.node.waitingLead') : t('cerberus.node.emptyLead')}</span>{' '}
          {waiting ? t('cerberus.node.waitingMessage') : t('cerberus.node.emptyMessage', { node: node.id })}
        </p>
      ) : (
        node.services.map((service) => (
          <ServiceRow key={service.service} node={node.id} service={service} face="grid" onOpenCell={onOpenCell} />
        ))
      )}
      <NodeProjects node={node.id} colocated={node.colocated} link={node.link} projects={node.projects} face="grid" returnFocus={() => closeRef.current?.focus()} />
    </Card>
  );
}
