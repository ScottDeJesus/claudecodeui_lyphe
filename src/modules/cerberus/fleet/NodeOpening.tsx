import { Bell } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { groupOf } from '@/modules/cerberus/fleet/fleetModel';
import { NeedCard } from '@/modules/cerberus/fleet/NeedCard';
import { NodeProjects } from '@/modules/cerberus/fleet/NodeProjects';
import { ServiceRow } from '@/modules/cerberus/fleet/ServiceRow';
import { UpdatingPill } from '@/modules/cerberus/fleet/UpdatingPill';
import { useClock } from '@/modules/cerberus/hooks/useClock';
import { useLeavingNeeds } from '@/modules/cerberus/hooks/useLeavingNeeds';
import { markLook, nodeMark } from '@/modules/cerberus/utils/cerberusStatus';
import { hm } from '@/modules/cerberus/utils/cerberusTime';
import { isRestarting, muteTimeLeft, nodeLine, sessionsTail, wardenLine } from '@/modules/cerberus/utils/fleetWords';
import type { CerberusCheckView, CerberusNodeView, CerberusOverview } from '@/shared/cerberus-types';
import type { CerberusSheetTarget, FleetItem } from '@/shared/types';
import { Button, IconWord, Rule } from '@/shared/ui';
import { cn } from '@/shared/utils';

type NodeOpeningProps = {
  item: FleetItem;
  /** The overview's own node: its warden, its services and their minutes. */
  node: CerberusNodeView;
  /** The fleet, for what needs you on this machine and what is muted on it. */
  overview: CerberusOverview;
  /** Opens the check sheet: a need's name, a service row's name, or one of its minutes. */
  onOpenCell: (target: CerberusSheetTarget) => void;
  /** Opens the Mute dialog on a check that needs you. */
  onMute: (check: CerberusCheckView) => void;
};

/**
 * The warden's heartbeat: the positive dot breathing while the machine reports, the neutral dot still while it is silent, restarting
 * for an update (`link` `paused`), or not yet heard. Decoration: the warden line beside it says the same.
 */
function Heartbeat({ node }: { node: CerberusNodeView }) {
  const alive = node.link === 'reporting' && !isRestarting(node);
  return (
    <span
      aria-hidden
      data-tone={alive ? 'positive' : 'neutral'}
      className={cn('block size-1.5 flex-none rounded-full bg-tone-dot', alive && 'motion-safe:animate-cerberus-breathe')}
    />
  );
}

/**
 * A MACHINE, opened from its slot, under the Opening's title (its name) and word:
 *
 * 1. Its one line ("docstore — refused", in the tone's ink when it asks for a look), its description, its update while one is queued or
 *    running ("Updating · Restarting the warden", `UpdatingPill`), then its warden beside the heartbeat: "Warden 0.4.1 · silent since 17:41", "Cerberus · this server" for the hub, " · 2 sessions running here" after it.
 * 2. What needs you on it, worst first: each check that needs a person with its fix, its diagnosis and Mute (`NeedCard`). A check
 *    that stops needing you leaves over half a second, as it did on the old card.
 * 3. Its services, one `ServiceRow` each: a row's name opens the sheet at now, a minute opens it at that minute. A machine with
 *    nothing to watch says so in one sentence.
 * 4. What is muted on it, with Unmute.
 * 5. "Projects that run here" (`NodeProjects`), for a machine that runs on this one or holds a project.
 *
 * Drawn by the panel (`CerberusPanel`) inside a machine's Opening.
 */
export function NodeOpening({ item, node, overview, onOpenCell, onMute }: NodeOpeningProps) {
  const { t } = useTranslation();
  const { liftMute } = useCerberus();
  const now = useClock();
  // Where focus goes when the machine's last project moves back and its section is gone: the Opening itself.
  const rootRef = useRef<HTMLDivElement>(null);
  const line = nodeLine(t, item, node);
  const warden = wardenLine(t, node, overview.now);
  const sessions = sessionsTail(t, node);
  // The words that ask for a look, needs you and no result, write the line in their tone's ink, as the old card did.
  const mark = nodeMark(item.status);
  const inked = mark !== null && (groupOf(item.status) === 'needs' || item.status === 'unknown') ? markLook(mark).tone : undefined;
  // One array per read, not per render: the leaving list compares what it is handed with what it held.
  const own = useMemo(() => overview.needsYou.filter((need) => need.check.node === node.id), [overview.needsYou, node.id]);
  const needs = useLeavingNeeds(own);
  const muted = overview.muted.flatMap((check) => (check.node === node.id && check.mute !== null ? [{ check, mute: check.mute }] : []));
  const waiting = node.link === 'never';

  return (
    <div ref={rootRef} tabIndex={-1} className="cerberus-opening flex flex-col gap-4 outline-none" data-cerberus-node={node.id}>
      <div className="flex flex-col gap-1">
        <p data-tone={inked} className={inked !== undefined ? 'text-[13px] text-tone-ink' : 'text-[13px] text-muted-foreground'}>
          {line}
        </p>
        {item.desc !== null && <p className="text-[12.5px] text-muted-foreground">{item.desc}</p>}
        {node.updating !== null && <span className="mt-0.5 flex"><UpdatingPill updating={node.updating} /></span>}
        {warden !== line && (
          <p className="flex items-center gap-[7px] text-[12px] text-muted-foreground">
            <Heartbeat node={node} />
            {warden}
            {sessions}
          </p>
        )}
      </div>

      {needs.length > 0 && (
        <section className="flex flex-col gap-2">
          <Rule level={4} end={String(needs.length)} endTone="warn">{t('cerberus.needs.title')}</Rule>
          <ul className="cerberus-needs flex flex-col">
            {needs.map(({ need, leaving }) => (
              <NeedCard key={`${need.check.node}/${need.check.key}`} need={need} leaving={leaving} onOpen={onOpenCell} onMute={onMute} />
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-1">
        <Rule level={4} end={node.services.length > 0 ? String(node.services.length) : undefined}>{t('cerberus.ring.services', { defaultValue: 'Services' })}</Rule>
        {node.services.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            <span className="text-foreground">{waiting ? t('cerberus.node.waitingLead') : t('cerberus.node.emptyLead')}</span>{' '}
            {waiting ? t('cerberus.node.waitingMessage') : t('cerberus.node.emptyMessage', { node: node.id })}
          </p>
        ) : (
          <div className="cerberus-services flex flex-col">
            {node.services.map((service) => (
              <ServiceRow key={service.service} node={node.id} service={service} onOpenCell={onOpenCell} />
            ))}
          </div>
        )}
      </section>

      {muted.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <Rule level={4}>{t('cerberus.needs.mutedTitle', { count: muted.length })}</Rule>
          <ul className="flex flex-col gap-2.5">
            {muted.map(({ check, mute }) => (
              <li key={mute.id} className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-foreground [overflow-wrap:anywhere]">
                    {t('cerberus.needs.mutedItem', { label: check.label ?? check.key, service: check.serviceLabel ?? check.service })}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {t('cerberus.needs.mutedMeta', { time: hm(mute.until), left: muteTimeLeft(t, mute.until, now), reason: mute.reason })}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="finger:size-11 finger:px-0" aria-label={t('cerberus.needs.unmute')} title={t('cerberus.needs.unmute')} onClick={() => void liftMute(mute.id)}>
                  <IconWord icon={Bell} word={t('cerberus.needs.unmute')} />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <NodeProjects node={node.id} colocated={node.colocated} link={node.link} projects={node.projects} returnFocus={() => rootRef.current?.focus()} />
    </div>
  );
}
