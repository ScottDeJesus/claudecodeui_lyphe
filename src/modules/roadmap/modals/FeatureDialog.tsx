import { Ban, FolderInput, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useFeatureCases } from '@/modules/roadmap/hooks/useFeatureCases';
import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { BlockDialog } from '@/modules/roadmap/modals/BlockDialog';
import { DeleteDialog } from '@/modules/roadmap/modals/DeleteDialog';
import { FeatureCases } from '@/modules/roadmap/modals/FeatureCases';
import { FeatureFacts } from '@/modules/roadmap/modals/FeatureFacts';
import { ItemDialog } from '@/modules/roadmap/modals/ItemDialog';
import { MoveDialog } from '@/modules/roadmap/modals/MoveDialog';
import { PromoteDialog } from '@/modules/roadmap/modals/PromoteDialog';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { RoadmapAct, RoadmapEpic, RoadmapFeature, RoadmapMilestone, RoadmapPicture } from '@/shared/roadmap-types';
import { ActionMenu, Banner, Button, Chip, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';

/** What is open over the feature's own dialog: one follow-on, opened from its presses. `goal` is the edit opened on the goal first, and `then` is what follows its Save. */
type FollowOn = { dialog: 'edit' | 'move' | 'block' | 'delete' | 'promote' } | { dialog: 'goal'; then: 'propose' | 'promote' | null };

/** The dialog as it opens: the feature itself, nothing open over it. */
const NO_FOLLOW_ON: FollowOn | null = null;

/** No write out from this dialog's own presses: what it opens with. */
const NOTHING_OUT: RoadmapAct | null = null;

/** Where a feature stands: the feature whole, and the epic and milestone above it. */
type Place = { feature: RoadmapFeature; epic: RoadmapEpic; milestone: RoadmapMilestone };

type FeatureDialogProps = {
  /** The feature's name: it is read off each new picture, so the dialog redraws from the store and closes once the feature is gone. */
  name: string;
  /** Opens the feature's own card on the In flight face — `RoadmapPath`'s, which the tab supplies. */
  onOpenCard: (plan: string) => void;
  onClose: () => void;
};

/** Where `name` stands on any roadmap of the picture, or null: a feature no epic on a roadmap holds has no place, and no dialog. */
function placeOf(picture: RoadmapPicture, name: string): Place | null {
  for (const roadmap of picture.roadmaps) {
    for (const milestone of roadmap.milestones) {
      for (const epic of milestone.epics) {
        const feature = epic.features.find((item) => item.name === name);
        if (feature) return { feature, epic, milestone };
      }
    }
  }
  return null;
}

/**
 * THE FEATURE, WHOLE: where it lives ("<epic> · <milestone>"), its title in the display serif and its
 * project; then, first under the head, whatever is in its way in warn — waiting on the operator, blocked
 * (with Unblock beside the reason), or under a blocked epic or milestone; then `FeatureFacts`, which
 * draws the feature's cases (`FeatureCases`) once the picture counts one: their sentences are read here as
 * the dialog opens, never carried on the polled picture.
 *
 * ITS PRESSES FOLLOW ITS WORD. The way forward is the footer, one or two buttons: an idea is Propose
 * (lined up, cheap to undo) and Promote; a proposed feature is Promote and Back to idea; a designing or
 * in-flight one is Open its card — or, while it waits on the operator, Answer on its card, the one press
 * that goes to the same card for what it owes; a shipped one has nowhere left to go. Upkeep is the ⋯
 * menu, as on every epic and milestone: Edit (Edit title and project once designed), Move… (never while it
 * is being designed or built), Mark blocked…, and Delete idea… or Delete… while nothing is designed.
 *
 * A FEATURE WITH NO GOAL CANNOT BE PROPOSED OR PROMOTED (the store refuses it), so its Propose and Promote
 * open `ItemDialog` on the goal first, and its Save says what follows. Promote always asks first
 * (`PromoteDialog`), because it starts a real Eupalinos.
 *
 * A FOLLOW-ON OPENS OVER IT, AND THE FEATURE STAYS. `ItemDialog`, `MoveDialog`, `BlockDialog`,
 * `DeleteDialog` and `PromoteDialog` draw over this dialog, their scrim fading in over a scrim that never
 * leaves, so the screen never goes bare between two steps of one task, and the feature is there when the
 * follow-on closes. Both dialogs hear an Escape (each listens on the window; a backdrop press lands on
 * the follow-on's own scrim), so this one ignores a close while a follow-on is up: the first Escape closes
 * the follow-on, the next this one.
 * (Each library `Dialog` also saves and restores `body.style.overflow`; stacked, two restores can cross,
 * which `html, body { overflow: hidden }` in `src/index.css` makes harmless.) The feature is read off each
 * frame, so what a follow-on hands back to already shows its write; a frame without the feature closes
 * this dialog, follow-on and all.
 *
 * Used by the roadmap module: the Roadmap face's dialog host opens it from a feature row (an epic's card,
 * the rail) and the chat gutter's roadmap widget from its rows.
 */
export function FeatureDialog({ name, onOpenCard, onClose }: FeatureDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  useReturnFocus();

  // The live picture the feature, its place and its waits are read from: each new frame redraws them.
  const { picture } = useRoadmap();
  const writes = useRoadmapWrites();
  // Which follow-on is open over this dialog, one at a time (a dialog is modal), or none: the feature alone.
  const [followOn, setFollowOn] = useState<FollowOn | null>(NO_FOLLOW_ON);
  // The act this dialog's own presses have out (propose, unpropose, unblock): its press shows busy and none is sent twice.
  const [busy, setBusy] = useState<RoadmapAct | null>(NOTHING_OUT);

  const place = useMemo(() => (picture === null ? null : placeOf(picture, name)), [picture, name]);
  // The feature's cases as the Cases section lists them: the list, whether a read is out, and why the latest one
  // failed. Read as the dialog opens, then again ONLY when one of the six counts differs BY VALUE from those the
  // last read answered for — every frame hands a new `cases` object, changed or not, so the object is never the
  // key — and a re-read keeps the last list while it is out. So a case that breaks while the dialog is open is
  // never still listed as holding beside a row that says "1 broken", and the list never blinks on a poll.
  const caseRead = useFeatureCases(name, place?.feature.cases ?? null);

  // A FRAME CAN END THE DIALOG: once a picture no longer holds the feature (deleted, here or on another
  // device), there is nothing left to show. No picture yet is a reading still on its way.
  useEffect(() => {
    if (picture !== null && place === null) onClose();
  }, [picture, place, onClose]);

  if (place === null) return null;
  const { feature, epic, milestone } = place;
  const { word } = feature;
  const unpromoted = word === 'idea' || word === 'proposed';
  const building = word === 'designing' || word === 'in flight';
  const out = busy !== null;
  // The Cases section shows only for a feature the picture counts a case for.
  const keepsCases = feature.cases.total > 0;

  // One of this dialog's own writes, its press shown busy while it is out. The dialog stays on the feature
  // either way: a landed write shows in the next frame, and a refusal in the hook's toast.
  const write = async (act: RoadmapAct, send: () => Promise<boolean>) => {
    setBusy(act);
    await send();
    setBusy(NOTHING_OUT);
  };
  const proposeNow = () => write('propose', () => writes.propose({ name, itemTitle: feature.title }));
  // The store refuses a feature with no goal to propose or promote, so with none the press opens the goal first, and its Save says what follows.
  const propose = () => {
    if (feature.goal) void proposeNow();
    else setFollowOn({ dialog: 'goal', then: 'propose' });
  };
  const promote = () => setFollowOn(feature.goal ? { dialog: 'promote' } : { dialog: 'goal', then: 'promote' });
  const backToIdea = () => void write('unpropose', () => writes.unpropose({ name, itemTitle: feature.title }));
  const unblock = () => void write('unblock', () => writes.unblock({ kind: 'plan', name, itemTitle: feature.title }));
  const writeGoal = () => setFollowOn({ dialog: 'goal', then: null });
  const edit = () => setFollowOn({ dialog: 'edit' });
  const move = () => setFollowOn({ dialog: 'move' });
  const markBlocked = () => setFollowOn({ dialog: 'block' });
  const remove = () => setFollowOn({ dialog: 'delete' });
  // A follow-on closes through here. A goal just written carries on to what it was written for — the propose,
  // or the question before a promote; a delete that landed ends this dialog too (the feature is gone). Anything
  // else, written or not, is back to the feature, which already shows what was written.
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
    setFollowOn(NO_FOLLOW_ON);
    if (written && closed?.dialog === 'goal' && closed.then === 'propose') void proposeNow();
  };

  const upkeep: ActionMenuItem[] = [
    { key: 'edit', label: t(unpromoted ? 'roadmap.dialog.feature.edit' : 'roadmap.dialog.feature.editTitleProject'), icon: Pencil, onSelect: edit },
    ...(building ? [] : [{ key: 'move', label: t('roadmap.dialog.feature.move'), icon: FolderInput, onSelect: move }]),
    // Blocked, its Unblock is beside the reason; shipped, there is nothing left for it to be blocked from.
    ...(feature.blocked !== null || word === 'shipped' ? [] : [{ key: 'block', label: t('roadmap.dialog.feature.markBlocked'), icon: Ban, onSelect: markBlocked }]),
    ...(unpromoted
      ? [{ key: 'delete', label: t(word === 'idea' ? 'roadmap.dialog.feature.deleteIdea' : 'roadmap.dialog.feature.delete'), icon: Trash2, isDanger: true, showDividerBefore: true, onSelect: remove }]
      : []),
  ];

  // The way forward, right-aligned, the strongest press last. 44px tall on a phone, Verve's touch minimum.
  const press = (key: string, label: string, onClick: () => void, variant: 'default' | 'outline' | 'ghost', act?: RoadmapAct): ReactNode => (
    <Button key={key} variant={variant} className="max-md:h-11" disabled={out} aria-busy={(act !== undefined && busy === act) || undefined} onClick={onClick}>
      {label}
    </Button>
  );
  const forward: ReactNode[] = word === 'idea'
    ? [press('promote', t('roadmap.dialog.feature.promote'), promote, 'outline'), press('propose', t('roadmap.dialog.feature.propose'), propose, 'default', 'propose')]
    : word === 'proposed'
      ? [press('back', t('roadmap.dialog.feature.backToIdea'), backToIdea, 'ghost', 'unpropose'), press('promote', t('roadmap.dialog.feature.promote'), promote, 'default')]
      : !building ? []
        : feature.waiting_on_you !== null
          ? [press('answer', t('roadmap.dialog.feature.answerCard'), () => onOpenCard(feature.name), 'default')]
          : [press('open', t('roadmap.dialog.feature.openCard'), () => onOpenCard(feature.name), 'outline')];

  const owed = feature.waiting_on_you;
  const warnings = owed !== null || feature.blocked !== null || epic.blocked !== null || milestone.blocked !== null;

  return (
    <>
      {/* Always open: a follow-on draws over it. An Escape while one is up is the follow-on's (both hear it), never this dialog's. */}
      <Dialog open onOpenChange={(open) => { if (!open && followOn === null) onClose(); }}>
        <DialogContent
          aria-labelledby={titleId}
          data-roadmap-dialog="feature"
          data-roadmap-word={word}
          className="flex max-h-[min(92dvh,52rem)] w-[calc(100vw-1rem)] max-w-xl flex-col overflow-hidden p-0"
        >
          <header className="flex shrink-0 items-start gap-2 px-6 pb-4 pt-5">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 break-words text-sm text-muted-foreground">
                {t('roadmap.dialog.feature.path', { epic: epic.title, milestone: milestone.title })}
              </p>
              <DialogTitle id={titleId} className="not-sr-only mt-1 break-words font-serif text-[1.75rem]/[1.15] font-normal text-foreground">
                {feature.title}
              </DialogTitle>
              <div className="mt-2.5 flex">
                <Chip size="sm">{feature.project}</Chip>
              </div>
            </div>
            <div className="-mr-2 -mt-1 flex shrink-0 items-center">
              {/* 44px on a phone, Verve's touch minimum: on a shipped feature the × is the one visible way out. */}
              <ActionMenu label={t('roadmap.menu.actions', { title: feature.title })} items={upkeep} icon={MoreHorizontal} iconOnly variant="ghost" size="icon" triggerClassName="h-9 w-9 max-md:h-11 max-md:w-11" />
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground max-md:h-11 max-md:w-11" aria-label={t('roadmap.dialog.close')} onClick={onClose}>
                <X aria-hidden="true" />
              </Button>
            </div>
          </header>

          {/* The body scrolls itself, as the panel's one flexible row: the panel has only a max height, so a scroller
              that sizes itself by percent inside it (`ScrollArea`'s inner `h-full`) never gets a height, and a phone
              lost the bottom of a long feature, unscrollable. `relative` keeps its sr-only words inside it. */}
          <div data-roadmap-dialog-body className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="flex flex-col gap-6 px-6 pb-6">
              {warnings && (
                <div className="flex flex-col gap-2">
                  {owed !== null && <Banner tone="warn">{t(owed === 'accept' ? 'roadmap.feature.waitingAccept' : 'roadmap.feature.waitingQuestions')}</Banner>}
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
              <FeatureFacts
                feature={feature}
                picture={picture}
                onWriteGoal={writeGoal}
                cases={keepsCases ? <FeatureCases cases={caseRead.cases} loading={caseRead.loading} failure={caseRead.failure} /> : null}
              />
            </div>
          </div>

          {forward.length > 0 && (
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-border px-6 py-4">{forward}</footer>
          )}
        </DialogContent>
      </Dialog>

      {followOn?.dialog === 'edit' && <ItemDialog kind="plan" item={feature} onClose={closeFollowOn} />}
      {followOn?.dialog === 'goal' && <ItemDialog kind="plan" item={feature} goalFirst={{ then: followOn.then }} onClose={closeFollowOn} />}
      {followOn?.dialog === 'move' && <MoveDialog kind="plan" name={feature.name} onClose={closeFollowOn} />}
      {followOn?.dialog === 'block' && <BlockDialog kind="plan" item={feature} onClose={closeFollowOn} />}
      {followOn?.dialog === 'delete' && <DeleteDialog kind="plan" item={feature} onClose={closeFollowOn} />}
      {followOn?.dialog === 'promote' && <PromoteDialog feature={feature} onClose={closeFollowOn} />}
    </>
  );
}
