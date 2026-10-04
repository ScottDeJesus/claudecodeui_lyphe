import { Ban, FolderInput, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react';
// FILL: imports — the markers' own: react's useState beside these, and useRoadmap and useRoadmapWrites
import { useEffect, useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FAKE_PICTURE } from '@/modules/roadmap/fake'; // FILL: fake — retired with the picture's fake below
import { BlockDialog } from '@/modules/roadmap/modals/BlockDialog';
import { DeleteDialog } from '@/modules/roadmap/modals/DeleteDialog';
import { FeatureFacts } from '@/modules/roadmap/modals/FeatureFacts';
import { ItemDialog } from '@/modules/roadmap/modals/ItemDialog';
import { MoveDialog } from '@/modules/roadmap/modals/MoveDialog';
import { PromoteDialog } from '@/modules/roadmap/modals/PromoteDialog';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { RoadmapAct, RoadmapEpic, RoadmapFeature, RoadmapMilestone, RoadmapPicture } from '@/shared/roadmap-types';
import { ActionMenu, Banner, Button, Chip, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui';
import { folderName } from '@/shared/utils';

// Each fill marker below governs the ONE statement under it, which holds a fake standing in for what the
// fill reads, holds or does; a marker standing alone marks the line the fill adds there. `imports` governs
// the react import under it and the lines the fill adds beside it, and `fake` the import it sits on, which
// the fill deletes. Every other line is composition and stays as it is.

/** What stands in for the feature's own dialog: one follow-on, opened from its presses. `goal` is the edit opened on the goal first, and `then` is what follows its Save. */
type FollowOn = { dialog: 'edit' | 'move' | 'block' | 'delete' | 'promote' } | { dialog: 'goal'; then: 'propose' | 'promote' | null };

/** The dialog as it opens: the feature itself, no follow-on in its place. */
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
 * (with Unblock beside the reason), or under a blocked epic or milestone; then `FeatureFacts`.
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
 * ONE DIALOG AT A TIME. A follow-on — `ItemDialog`, `MoveDialog`, `BlockDialog`, `DeleteDialog`,
 * `PromoteDialog` — is drawn IN PLACE of this one and hands back to it when it closes: two dialogs open
 * at once would both take the same Escape. The feature is read off each frame, so what it hands back to
 * already shows the write; a frame without the feature closes it.
 *
 * Used by the roadmap module: the Roadmap face's dialog host opens it from a feature row (an epic's card,
 * the rail) and the chat gutter's roadmap widget from its rows.
 */
export function FeatureDialog({ name, onOpenCard, onClose }: FeatureDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  useReturnFocus();

  // FILL: picture — useRoadmap().picture: the live picture the feature, its place and its waits are read from
  const picture: RoadmapPicture | null = FAKE_PICTURE;
  // FILL: writes — const writes = useRoadmapWrites(): Propose, Back to idea and Unblock write through it here; each follow-on writes its own
  // FILL: followOn — component state, with its comment: which follow-on stands in for this dialog, opening on NO_FOLLOW_ON
  const followOn: FollowOn | null = NO_FOLLOW_ON;
  // FILL: busy — component state, with its comment: the act this dialog's own presses have out (propose, unpropose, unblock), so its press shows busy and none is sent twice
  const busy: RoadmapAct | null = NOTHING_OUT;
  // FILL: onPropose — writes.propose({ name, itemTitle: feature.title }) with busy 'propose'; with no goal, setFollowOn({ dialog: 'goal', then: 'propose' }) instead
  const propose = () => {};
  // FILL: onPromote — setFollowOn({ dialog: 'promote' }); with no goal, setFollowOn({ dialog: 'goal', then: 'promote' }) instead
  const promote = () => {};
  // FILL: onBackToIdea — writes.unpropose({ name, itemTitle: feature.title }) with busy 'unpropose'
  const backToIdea = () => {};
  // FILL: onUnblock — writes.unblock({ kind: 'plan', name, itemTitle: feature.title }) with busy 'unblock'
  const unblock = () => {};
  // FILL: onWriteGoal — setFollowOn({ dialog: 'goal', then: null }), from the goal's empty place
  const writeGoal = () => {};
  // FILL: onEdit — setFollowOn({ dialog: 'edit' }), from Edit and Edit title and project
  const edit = () => {};
  // FILL: onMove — setFollowOn({ dialog: 'move' })
  const move = () => {};
  // FILL: onMarkBlocked — setFollowOn({ dialog: 'block' })
  const markBlocked = () => {};
  // FILL: onDelete — setFollowOn({ dialog: 'delete' }), from Delete idea… and Delete…
  const remove = () => {};
  // FILL: onOpenCard — the prop itself (const openCard = onOpenCard): the face turns to In flight on the card named, and this dialog goes with the face
  const openCard: typeof onOpenCard = () => {};
  // FILL: onFollowOnClosed — (written) => a goal written for `then` 'propose' runs writes.propose with busy 'propose', for 'promote' opens setFollowOn({ dialog: 'promote' }); a landed delete closes this dialog (onClose()); anything else is setFollowOn(null), back to the feature
  const closeFollowOn = (_written: boolean) => {};

  const place = useMemo(() => (picture === null ? null : placeOf(picture, name)), [picture, name]);

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
          ? [press('answer', t('roadmap.dialog.feature.answerCard'), () => openCard(feature.name), 'default')]
          : [press('open', t('roadmap.dialog.feature.openCard'), () => openCard(feature.name), 'outline')];

  const owed = feature.waiting_on_you;
  const warnings = owed !== null || feature.blocked !== null || epic.blocked !== null || milestone.blocked !== null;

  return (
    <>
      <Dialog open={followOn === null} onOpenChange={(open) => { if (!open) onClose(); }}>
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
                <Chip size="sm">{feature.project ?? folderName(feature.repo)}</Chip>
              </div>
            </div>
            <div className="-mr-2 -mt-1 flex shrink-0 items-center">
              <ActionMenu label={t('roadmap.menu.actions', { title: feature.title })} items={upkeep} icon={MoreHorizontal} iconOnly variant="ghost" size="icon" triggerClassName="h-9 w-9" />
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" aria-label={t('roadmap.dialog.close')} onClick={onClose}>
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
                        <Button variant="ghost" size="sm" className="-my-1.5 h-8 shrink-0 px-2.5 max-md:h-11" disabled={out} aria-busy={busy === 'unblock' || undefined} onClick={unblock}>
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
              <FeatureFacts feature={feature} picture={picture} onWriteGoal={writeGoal} />
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
