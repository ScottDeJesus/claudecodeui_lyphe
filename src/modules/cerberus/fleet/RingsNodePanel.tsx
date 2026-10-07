import { useTranslation } from 'react-i18next';

import { groupOf } from '@/modules/cerberus/fleet/fleetModel';
import { Heartbeat, NodeGlyph } from '@/modules/cerberus/fleet/NodeCard';
import { ServiceRow } from '@/modules/cerberus/fleet/ServiceRow';
import { nodeMark, STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { nodeLine, wardenLine } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusNodeView } from '@/shared/cerberus-types';
import type { CerberusSheetTarget, FleetItem } from '@/shared/types';
import { Card } from '@/shared/ui';
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
 * heartbeat: "Warden 0.4.1 · silent since 17:41", or "Cerberus · this server" for the hub. Before a node's
 * first heartbeat that line is the node's own line, so it is said once, in the head. Then come its
 * services, one `ServiceRow` each, the rows its card opens to in Grid. A row's name opens the sheet at
 * now, and a minute opens it at that minute. A node with nothing to watch says so in one sentence.
 *
 * It rises with `vv-pop`. The rings key it by node, so each new selection rises again.
 *
 * Used by Fleet's `FleetRings`, for the node or the hub its rings have selected.
 */
export function RingsNodePanel({ item, node, now, onClose, onOpenCell }: RingsNodePanelProps) {
  const { t } = useTranslation();
  const mark = nodeMark(item.status);
  const tone = mark === null ? undefined : STATUS_TABLE[mark].tone;
  // The words that ask for a look, needs you and no result, write the line in their tone's ink, as a card does.
  const inked = tone !== undefined && (groupOf(item.status) === 'needs' || item.status === 'unknown');
  const line = nodeLine(t, item, node);
  const warden = wardenLine(t, node, now);
  const waiting = node.link === 'never';
  const close = t('cerberus.fleet.rings.close');

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
        <button
          type="button"
          onClick={onClose}
          aria-label={close}
          title={close}
          className="flex size-7 flex-none items-center justify-center rounded-full text-[13px] text-muted-foreground transition-colors duration-quick hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      {warden !== line && (
        <p className="flex items-center gap-[7px] px-4 pb-3 text-xs text-muted-foreground">
          <Heartbeat node={node} />
          {warden}
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
      {/* SLOT: projects — the sessions plan's `NodeProjects` ("Projects that run here", "Run a project here")
          follows a co-located node's services, as it does on the node's card in Grid. */}
    </Card>
  );
}
