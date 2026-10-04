import type { TFunction } from 'i18next';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoadmap } from '@/modules/roadmap/hooks/useRoadmap';
import { useRoadmapWrites } from '@/modules/roadmap/hooks/useRoadmapWrites';
import { useReturnFocus } from '@/shared/hooks/useReturnFocus';
import type { Roadmap, RoadmapPicture, RoadmapWriteBody } from '@/shared/roadmap-types';
import { Button, Chip, Dialog, DialogContent, DialogTitle, Field, Select } from '@/shared/ui';

/** What moves: the dispatcher's own word — `plan` a feature into an epic, `arc` an epic into a milestone, `milestone` into a roadmap. */
type MovedKind = 'milestone' | 'arc' | 'plan';

/** Where in its new place an item lands: before what is there, or after it. */
type Landing = 'top' | 'bottom';

/** Where a move lands until the operator says otherwise: At the bottom, after what the place already holds. */
const LANDS_AT: Landing = 'bottom';

/** Where the item stands now: its title, its parent's name and how the list names that parent (null for an item no roadmap holds yet), and its roadmap. */
type Standing = { title: string; parent: string | null; place: string | null; home: string | null };

/** One place the item can go: the parent's name, what the list calls it, and its children in order with the item itself left out. */
type Destination = { name: string; label: string; children: string[] };

type MoveDialogProps = {
  kind: MovedKind;
  /** The item's name: its title and where it stands are read off each new picture, so the dialog closes once it is gone. */
  name: string;
  /** Closes the dialog: `true` once the store took the move, `false` on Cancel, Escape or the backdrop. */
  onClose: (written: boolean) => void;
};

/** Where `name` stands in the picture — on a roadmap, or in `unplaced` — or null once it is gone. */
function standingOf(picture: RoadmapPicture, kind: MovedKind, name: string, t: TFunction): Standing | null {
  for (const roadmap of picture.roadmaps) {
    for (const milestone of roadmap.milestones) {
      if (kind === 'milestone' && milestone.name === name) return { title: milestone.title, parent: roadmap.name, place: roadmap.title, home: roadmap.name };
      for (const epic of milestone.epics) {
        if (kind === 'arc' && epic.name === name) return { title: epic.title, parent: milestone.name, place: milestone.title, home: roadmap.name };
        const feature = kind === 'plan' ? epic.features.find((item) => item.name === name) : undefined;
        if (feature) return { title: feature.title, parent: epic.name, place: t('roadmap.dialog.move.epicIn', { milestone: milestone.title, epic: epic.title }), home: roadmap.name };
      }
    }
  }
  const loose = kind === 'plan' ? picture.unplaced.features : kind === 'arc' ? picture.unplaced.epics : [];
  const found = loose.find((item) => item.name === name);
  return found ? { title: found.title, parent: null, place: null, home: null } : null;
}

/**
 * Every place the item can go, in path order: the epics of every milestone for a feature, the milestones
 * for an epic, the roadmaps for a milestone. Its own roadmap's come first, called as the roadmap calls
 * them ("<milestone> · <epic>"); another roadmap's follow, with that roadmap's title in front. Its own
 * parent stays a choice: moving there At the top or At the bottom is how it is reordered from here.
 */
function destinationsOf(picture: RoadmapPicture, kind: MovedKind, name: string, home: string | null, t: TFunction): Destination[] {
  const others = (names: string[]) => names.filter((child) => child !== name);
  if (kind === 'milestone') {
    return picture.roadmaps.map((roadmap) => ({ name: roadmap.name, label: roadmap.title, children: others(roadmap.milestones.map((item) => item.name)) }));
  }
  const ordered: Roadmap[] = [...picture.roadmaps.filter((item) => item.name === home), ...picture.roadmaps.filter((item) => item.name !== home)];
  return ordered.flatMap((roadmap) => {
    const away = (place: string) => (roadmap.name === home ? place : t('roadmap.dialog.move.elsewhere', { roadmap: roadmap.title, place }));
    return roadmap.milestones.flatMap((milestone) => (kind === 'arc'
      ? [{ name: milestone.name, label: away(milestone.title), children: others(milestone.epics.map((item) => item.name)) }]
      : milestone.epics.map((epic) => ({
          name: epic.name,
          label: away(t('roadmap.dialog.move.epicIn', { milestone: milestone.title, epic: epic.title })),
          children: others(epic.features.map((item) => item.name)),
        }))));
  });
}

/** Where a move lands: into `destination`, before its first child (At the top) or after its last (At the bottom); an empty one takes the item as its only child. */
function placementOf(destination: Destination, where: Landing): Pick<RoadmapWriteBody, 'to' | 'before' | 'after'> {
  const { children } = destination;
  if (children.length === 0) return { to: destination.name };
  return where === 'top' ? { to: destination.name, before: children[0] } : { to: destination.name, after: children[children.length - 1] };
}

/**
 * Move one item to another parent — a feature to an epic, an epic to a milestone, a milestone to a
 * roadmap — at the top or at the bottom of what that parent holds. The places are the picture's own, in
 * path order, its own roadmap's first. Under the title, in the muted ink that reads at AA, is where the
 * item is now ("Now in …"), or "Not on a roadmap yet" for one the banner places, whose dialog says Place
 * where another says Move. Move waits until a place is chosen, and an empty place drops the top-or-bottom
 * choice: the item will be all it holds.
 *
 * The choice of place is the library `Select`, opened in place, so the dialog is sized to its content and
 * the list opens past its edge. A screen too short for the dialog itself (600px and under: a phone held
 * sideways) scrolls the dialog instead, and an open list grows what it scrolls. A picture with nowhere to
 * go says so in a sentence instead of a field.
 *
 * Mounted for as long as it is open (`useReturnFocus`); a frame that no longer holds the item closes it.
 * A landed move closes it; a refusal keeps it open, beside the hook's toast.
 *
 * Used by the roadmap module: `FeatureDialog` (Move…) and the Roadmap face's dialog host (an epic's Move
 * to milestone…, and Place… on what the unplaced banner lists).
 */
export function MoveDialog({ kind, name, onClose }: MoveDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const writes = useRoadmapWrites();
  useReturnFocus();

  // The places are read off the live picture, and an item no roadmap holds yet (the banner's Place…) is
  // placed from the roadmap on screen: `selected` stands in for its `home`.
  const { picture, selected } = useRoadmap();
  // The place chosen, by name: null until one is. Local to the form — nothing outside needs it until Move sends it.
  const [to, setTo] = useState<string | null>(null);
  // Where in the place the item lands, At the top or At the bottom; opens on LANDS_AT, the choice most moves mean.
  const [where, setWhere] = useState<Landing>(LANDS_AT);
  // The move is out, so Move shows busy and the ways out wait for its answer: the write is already at the dispatcher.
  const [busy, setBusy] = useState(false);

  const standing = useMemo(() => (picture === null ? null : standingOf(picture, kind, name, t)), [picture, kind, name, t]);
  const home = standing?.home ?? selected?.name ?? null;
  const destinations = useMemo(() => (picture === null ? [] : destinationsOf(picture, kind, name, home, t)), [picture, kind, name, home, t]);
  const destination = destinations.find((item) => item.name === to) ?? null;
  // What Move sends, once a place is chosen: none yet, and Move waits.
  const placement = destination === null ? null : placementOf(destination, where);
  const ready = placement !== null;

  const submit = async () => {
    if (placement === null || standing === null) return;
    setBusy(true);
    const landed = await writes.move({ kind, name, ...placement, itemTitle: standing.title });
    // A landed move closes the dialog; a refusal keeps it open, with the place as chosen, beside the hook's toast.
    if (landed) onClose(true);
    else setBusy(false);
  };

  // A FRAME CAN END THE QUESTION: once a picture no longer holds the item (deleted here or on another
  // device), there is nothing left to move. No picture yet is not that: it is a reading still on its way.
  useEffect(() => {
    if (picture !== null && standing === null) onClose(false);
  }, [picture, standing, onClose]);

  const dismiss = () => {
    if (!busy) onClose(false);
  };

  if (standing === null) return null;
  // An item no roadmap holds yet came from the banner's Place…, and the dialog says Place to match.
  const placing = standing.parent === null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) dismiss(); }}>
      <DialogContent
        aria-labelledby={titleId}
        data-roadmap-dialog="move"
        data-roadmap-kind={kind}
        className="w-[calc(100vw-2rem)] max-w-md p-0 [@media(max-height:600px)]:max-h-[calc(100dvh-1rem)] [@media(max-height:600px)]:overflow-y-auto"
      >
        <form
          className="flex flex-col gap-5 p-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !busy) submit();
          }}
        >
          <header className="min-w-0">
            <DialogTitle id={titleId} className="not-sr-only break-words font-serif text-2xl font-normal leading-tight text-foreground">
              {t(placing ? 'roadmap.dialog.move.placeTitle' : 'roadmap.dialog.move.title', { title: standing.title })}
            </DialogTitle>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {standing.place === null ? t('roadmap.dialog.move.nowhere') : t('roadmap.dialog.move.now', { place: standing.place })}
            </p>
          </header>

          {destinations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(`roadmap.dialog.move.none.${kind}`)}</p>
          ) : (
            <>
              <Field label={t('roadmap.dialog.move.to')}>
                <Select
                  options={destinations.map((item) => ({ value: item.name, label: item.label }))}
                  value={to ?? ''}
                  placeholder={t(`roadmap.dialog.move.choose.${kind}`)}
                  ariaLabel={t('roadmap.dialog.move.to')}
                  onChange={setTo}
                />
              </Field>
              {/* Top or bottom only means something beside what the place already holds. */}
              {(destination === null || destination.children.length > 0) && (
                <Field label={t('roadmap.dialog.move.where')}>
                  <div role="group" aria-label={t('roadmap.dialog.move.where')} className="flex flex-wrap gap-2">
                    <Chip selected={where === 'top'} onClick={() => setWhere('top')} className="max-md:min-h-11">
                      {t('roadmap.dialog.move.top')}
                    </Chip>
                    <Chip selected={where === 'bottom'} onClick={() => setWhere('bottom')} className="max-md:min-h-11">
                      {t('roadmap.dialog.move.bottom')}
                    </Chip>
                  </div>
                </Field>
              )}
            </>
          )}

          <footer className="flex flex-wrap justify-end gap-2.5 pt-1">
            <Button type="button" variant="ghost" className="max-md:h-11" disabled={busy} onClick={dismiss}>
              {t('roadmap.dialog.cancel')}
            </Button>
            <Button type="submit" className="max-md:h-11" disabled={!ready || busy} aria-busy={busy || undefined}>
              {t(placing ? 'roadmap.dialog.move.placeSubmit' : 'roadmap.dialog.move.submit')}
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
