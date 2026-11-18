import { ArrowLeft } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PlanCard, useDispatcherPlans, usePutAway, waitsOnSiblings } from '@/modules/dispatcher';
import { useRoadmapCard } from '@/modules/roadmap/hooks/useRoadmapCard';
import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { BlockDialog } from '@/modules/roadmap/modals/BlockDialog';
import { DeleteDialog } from '@/modules/roadmap/modals/DeleteDialog';
import { FeatureFacts } from '@/modules/roadmap/modals/FeatureFacts';
import { ItemDialog } from '@/modules/roadmap/modals/ItemDialog';
import { PromoteDialog } from '@/modules/roadmap/modals/PromoteDialog';
import { EpicPanel } from '@/modules/roadmap/panel/EpicPanel';
import { dotStateOf } from '@/modules/roadmap/utils/treeLayout';
import { useIsPageHeld } from '@/shared/context/HeldPageContext';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { RoadmapAct } from '@/shared/roadmap-types';
import type { RoadmapStackEpic, RoadmapStackTarget, RoadmapStackTier, RoadmapStackWall } from '@/shared/types';
import { Banner, Button, Card, Spinner } from '@/shared/ui';
import { OWNS_ESCAPE, modalInFrontHoldsEscape } from '@/shared/ui/overlayEscape';

/** What is open over the card: one of the roadmap's own questions, opened from a press on it. `goal` is the goal asked for first, and `then` is what follows its Save. */
type FollowOn = { dialog: 'block' | 'delete' | 'promote' } | { dialog: 'goal'; then: 'propose' | 'promote' | null };

type StackCardProps = {
  /** What the card is about: a feature or an epic of the stack, by name. */
  target: RoadmapStackTarget;
  /** The stack as laid out, which the card finds its feature or epic on; a picture that no longer holds it closes the card. */
  tiers: RoadmapStackTier[];
  onClose: () => void;
  /** A feature's row in an epic's card, pressed: that feature's wall comes round and its card opens. */
  onOpenFeature: (name: string) => void;
};

/** The frame every card of the stack opens in: the way back, then what it holds. It owns Escape while it is on screen. */
function CardFrame({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const hostWindow = useHostWindow();
  const isPageHeld = useIsPageHeld();
  const frameRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  // Focus goes back to the stack when the card leaves, and into the card as it opens, so the keyboard that opened it can close it.
  useReturnFocus();
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  // Escape is the card's while nothing that owns the key (a menu on the plan's card, one of the roadmap's questions) is in
  // front of it. Heard on the host window's capture phase and marked first, as `Sheet` does, so the chat never also stops a turn.
  useEffect(() => {
    const hostDocument = hostWindow.document;
    const onKeyDown = (event: KeyboardEvent) => {
      // A page held under another (the workspace under the station, the home under a chat) keeps its card and hears no key.
      if (event.key !== 'Escape' || isPageHeld()) return;
      event.preventDefault();
      if (modalInFrontHoldsEscape(frameRef.current, hostDocument)) return;
      event.stopPropagation();
      onClose();
    };
    hostWindow.addEventListener('keydown', onKeyDown, true);
    return () => hostWindow.removeEventListener('keydown', onKeyDown, true);
  }, [hostWindow, onClose, isPageHeld]);

  return (
    <div ref={frameRef} {...OWNS_ESCAPE} role="group" aria-label={label} className="flex min-w-0 flex-col gap-2">
      <div className="flex">
        <Button ref={backRef} variant="outline" size="icon" className="h-9 w-9 bg-card shadow-sm max-md:h-11 max-md:w-11" aria-label={t('roadmap.stack.back')} onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
        </Button>
      </div>
      {/* One shadow under whatever the card holds, so it reads as standing over the stack. */}
      <div className="min-w-0 [filter:drop-shadow(0_10px_24px_rgb(0_0_0/0.28))]">{children}</div>
    </div>
  );
}

/**
 * A FEATURE'S CARD ON THE STACK, drawn by its owners. A feature the dispatcher holds is the dispatcher's own `PlanCard`:
 * its tokens, its tasks and their runs, its ask and every press it has (Accept, Park, Stop, Resume), exactly as the In
 * flight face draws it. A feature it does not hold (an idea, a proposal, one long shipped) is the roadmap's own facts
 * (`FeatureFacts`) with the ways forward its word allows: an idea is Promote and Propose, a proposal is Back to idea and
 * Promote, as `FeatureDialog` has them. Whatever blocks it is said first, with Unblock beside its own reason.
 *
 * Its questions (the goal first for a feature with none, the promote, the block, the delete) are the roadmap's own
 * dialogs, opened over the card; a goal just written carries on to what it was written for.
 */
function FeatureCard({ tier, wall, onClose }: { tier: RoadmapStackTier; wall: RoadmapStackWall; onClose: () => void }) {
  const { t } = useTranslation();
  const { feature, epic } = wall;
  const { milestone } = tier;
  const { plans, hidden, carriedNames, route } = useDispatcherPlans();
  const putAway = usePutAway(carriedNames);
  const writes = useRoadmapWrites();
  // Which of the roadmap's questions is open over the card, one at a time (a dialog is modal), or none.
  const [followOn, setFollowOn] = useState<FollowOn | null>(null);
  // The act this card's own presses have out (propose, unpropose, unblock): its press shows busy and none is sent twice.
  const [busy, setBusy] = useState<RoadmapAct | null>(null);

  // The dispatcher's plan of this name (hidden ones too: the card shows its Show), with the names of its own arc it waits on.
  const held = useMemo(() => {
    const plan = plans.find((item) => item.name === feature.name) ?? hidden.find((item) => item.name === feature.name);
    if (plan === undefined) return null;
    const members = plan.arc === null ? [] : plans.filter((item) => item.arc === plan.arc);
    return { plan, waitsOn: waitsOnSiblings(plan, members) };
  }, [plans, hidden, feature.name]);
  // `route` is null until the lane's first picture has landed: until then the dispatcher's silence means nothing, so the
  // roadmap's facts wait too, or the card would show them for a moment and then the plan's card (`CardStage`'s rule).
  const laneLanded = route !== null;
  const facts = useRoadmapCard(laneLanded && held === null ? feature.name : null);

  const { word, name } = feature;
  const out = busy !== null;
  const write = async (act: RoadmapAct, send: () => Promise<boolean>) => {
    setBusy(act);
    await send();
    setBusy(null);
  };
  const proposeNow = () => write('propose', () => writes.propose({ name, itemTitle: feature.title }));
  // The store refuses a feature with no goal to propose or promote, so with none the press opens the goal first.
  const propose = () => {
    if (feature.goal) void proposeNow();
    else setFollowOn({ dialog: 'goal', then: 'propose' });
  };
  const promote = () => setFollowOn(feature.goal ? { dialog: 'promote' } : { dialog: 'goal', then: 'promote' });
  const backToIdea = () => void write('unpropose', () => writes.unpropose({ name, itemTitle: feature.title }));
  const unblock = () => void write('unblock', () => writes.unblock({ kind: 'plan', name, itemTitle: feature.title }));
  // A question closes through here. A goal just written carries on to what it was written for; a delete that landed
  // ends the card too (the feature is gone).
  const closeFollowOn = (written: boolean) => {
    const closed = followOn;
    if (written && closed?.dialog === 'delete') {
      onClose();
      return;
    }
    if (written && closed?.dialog === 'goal' && closed.then === 'promote') {
      setFollowOn({ dialog: 'promote' });
      return;
    }
    setFollowOn(null);
    if (written && closed?.dialog === 'goal' && closed.then === 'propose') void proposeNow();
  };

  const press = (key: string, label: string, onClick: () => void, variant: 'default' | 'outline' | 'ghost', act?: RoadmapAct): ReactNode => (
    <Button key={key} variant={variant} size="sm" className="max-md:h-11" disabled={out} aria-busy={(act !== undefined && busy === act) || undefined} onClick={onClick}>
      {label}
    </Button>
  );
  // The ways forward its word allows, the strongest last; a feature the dispatcher holds has them on its own card.
  const forward: ReactNode[] = held !== null ? []
    : word === 'idea'
      ? [press('promote', t('roadmap.dialog.feature.promote'), promote, 'outline'), press('propose', t('roadmap.dialog.feature.propose'), propose, 'default', 'propose')]
      : word === 'proposed'
        ? [press('back', t('roadmap.dialog.feature.backToIdea'), backToIdea, 'ghost', 'unpropose'), press('promote', t('roadmap.dialog.feature.promote'), promote, 'default')]
        : [];
  // Upkeep, quiet and to the left: a mark it is blocked (never once shipped, and Unblock is beside the reason while it is), and the delete while nothing is designed.
  const upkeep: ReactNode[] = [
    ...(feature.blocked !== null || word === 'shipped' ? [] : [press('block', t('roadmap.dialog.feature.markBlocked'), () => setFollowOn({ dialog: 'block' }), 'ghost')]),
    ...(word === 'idea' || word === 'proposed' ? [press('delete', t(word === 'idea' ? 'roadmap.dialog.feature.deleteIdea' : 'roadmap.dialog.feature.delete'), () => setFollowOn({ dialog: 'delete' }), 'ghost')] : []),
  ];
  const blocks = feature.blocked !== null || epic.blocked !== null || milestone.blocked !== null;

  return (
    <CardFrame label={feature.title} onClose={onClose}>
      <div data-roadmap-stack-feature={held !== null ? 'plan' : 'facts'} data-roadmap-word={word} className="flex min-w-0 flex-col gap-2">
        {blocks && (
          <div className="flex flex-col gap-2">
            {feature.blocked !== null && (
              <Banner
                tone="warn"
                action={(
                  <Button variant="outline" size="sm" className="-my-1.5 h-8 shrink-0 px-2.5 max-md:h-11" disabled={out} aria-busy={busy === 'unblock' || undefined} onClick={unblock}>
                    {t('roadmap.dialog.feature.unblock')}
                  </Button>
                )}
              >
                <span className="break-words">{t('roadmap.blocked', { why: feature.blocked })}</span>
              </Banner>
            )}
            {epic.blocked !== null && <Banner tone="warn"><span className="break-words">{t('roadmap.dialog.feature.epicBlocked', { why: epic.blocked })}</span></Banner>}
            {milestone.blocked !== null && <Banner tone="warn"><span className="break-words">{t('roadmap.dialog.feature.milestoneBlocked', { why: milestone.blocked })}</span></Banner>}
          </div>
        )}

        {held !== null ? (
          <PlanCard plan={held.plan} waitsOn={held.waitsOn} onPutAway={putAway.plan(held.plan)} />
        ) : !laneLanded || facts === undefined ? (
          <Card className="grid place-items-center p-8"><Spinner size={32} label={t('roadmap.loading')} /></Card>
        ) : facts !== null && facts.kind === 'feature' && (
          <Card className="flex min-w-0 flex-col gap-5 p-4 lg:p-5">
            <header className="min-w-0">
              <p className="line-clamp-2 break-words text-sm text-muted-foreground">{t('roadmap.dialog.feature.path', { epic: epic.title, milestone: milestone.title })}</p>
              <h2 className="mt-1 break-words font-serif text-2xl/[1.15] font-normal text-foreground">{feature.title}</h2>
            </header>
            <FeatureFacts feature={facts.feature} picture={facts.picture} onWriteGoal={() => setFollowOn({ dialog: 'goal', then: null })} cases={facts.cases} />
          </Card>
        )}

        {(forward.length > 0 || upkeep.length > 0) && (
          <Card className="flex flex-wrap items-center gap-2 p-2">
            {upkeep}
            <span className="flex-1" />
            {forward}
          </Card>
        )}
      </div>

      {followOn?.dialog === 'goal' && <ItemDialog kind="plan" item={feature} goalFirst={{ then: followOn.then }} onClose={closeFollowOn} />}
      {followOn?.dialog === 'block' && <BlockDialog kind="plan" item={feature} onClose={closeFollowOn} />}
      {followOn?.dialog === 'delete' && <DeleteDialog kind="plan" item={feature} onClose={closeFollowOn} />}
      {followOn?.dialog === 'promote' && <PromoteDialog feature={feature} onClose={closeFollowOn} />}
    </CardFrame>
  );
}

/** An epic's card on the stack: the roadmap's own panel of it (`EpicPanel`), its features as rows; a row pressed brings that feature's wall round and opens its card. */
function EpicCard({ tier, run, onClose, onOpenFeature }: { tier: RoadmapStackTier; run: RoadmapStackEpic; onClose: () => void; onOpenFeature: (name: string) => void }) {
  const headingId = useId();
  const { epic } = run;
  const dots = useMemo(() => new Map(epic.features.map((feature) => [feature.name, dotStateOf(feature, epic, tier.milestone)] as const)), [epic, tier.milestone]);
  return (
    <CardFrame label={epic.title} onClose={onClose}>
      <Card data-roadmap-stack-epic={epic.name} role="region" aria-labelledby={headingId} className="min-w-0">
        <div className="flex min-w-0 flex-col gap-3 px-4 py-3.5">
          <EpicPanel
            epic={epic}
            n={tier.n}
            dots={dots}
            headingId={headingId}
            onSelect={(selection) => { if (selection.kind === 'feature') onOpenFeature(selection.name); }}
          />
        </div>
      </Card>
    </CardFrame>
  );
}

/** The feature's wall or the epic's thread a card is about, with the ring it stands on; null once the stack no longer holds the name. */
function findOnStack(tiers: RoadmapStackTier[], target: RoadmapStackTarget) {
  for (const tier of tiers) {
    if (target.kind === 'feature') {
      const wall = tier.walls.find((item) => item.feature.name === target.name);
      if (wall) return { kind: 'feature' as const, tier, wall };
    } else {
      const run = tier.epics.find((item) => item.epic.name === target.name);
      if (run) return { kind: 'epic' as const, tier, run };
    }
  }
  return null;
}

/**
 * THE CARD A PRESS ON THE STACK OPENS, in place: over the wall of the feature it is about, or over an epic's thread.
 * It is the one source for what it shows and the one place its presses are: no second panel opens from it, and
 * nothing behind it is dimmed. A back arrow, Escape, a press on the stack or a turn of it puts it away.
 *
 * It finds its feature or epic on the stack as laid out, so a new picture redraws it; a picture that no longer holds
 * the name closes it. Rendered only while open, which is what lets its frame state that it owns Escape (`OWNS_ESCAPE`).
 *
 * Used by `RoadmapStackFace`, as the `card` it hands `RoadmapStack` to place.
 */
export function StackCard({ target, tiers, onClose, onOpenFeature }: StackCardProps) {
  const found = findOnStack(tiers, target);

  // A picture can end the card: once it no longer holds the feature or the epic there is nothing left to show.
  const gone = found === null;
  useEffect(() => {
    if (gone) onClose();
  }, [gone, onClose]);

  if (found === null) return null;
  return found.kind === 'feature'
    ? <FeatureCard key={found.wall.feature.name} tier={found.tier} wall={found.wall} onClose={onClose} />
    : <EpicCard key={found.run.epic.name} tier={found.tier} run={found.run} onClose={onClose} onOpenFeature={onOpenFeature} />;
}
