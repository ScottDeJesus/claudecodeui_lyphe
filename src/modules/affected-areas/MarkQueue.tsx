import { CheckCheck, SkipForward } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LaneTrouble } from '@/modules/affected-areas/LaneTrouble';
import { MarkBar } from '@/modules/affected-areas/MarkBar';
import { KeyCap } from '@/modules/affected-areas/MarkPress';
import { REGION_LOOK, regionState } from '@/modules/affected-areas/utils/regionLook';
import { countedKind, kindName, roomWords } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, Queue, Region } from '@/shared/affected-areas-types';
import type { MarkWalk, RegionShape } from '@/shared/types';
import { Button, EmptyState, RegionImage, SegmentedControl, Select } from '@/shared/ui';

type QueueMode = Queue['mode'];

type MarkQueueProps = {
  codebook: Codebook | null;
  mode: QueueMode;
  /** The kind the queue is narrowed to, a codebook key; '' is every kind. */
  kind: string;
  walk: MarkWalk;
  /** The current area's view as an object URL; null while it loads, when it failed, or with no area on screen. */
  photo: string | null;
  onMode: (mode: QueueMode) => void;
  onKind: (kind: string) => void;
  onSkip: () => void;
  /** A mark answered: the walk moves on. */
  onMarked: (region: Region) => void;
};

/** A kind's label inside a sentence ("Is this water stain?"): the codebook's labels are sentence case, so only the first letter moves. */
function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** A region as `RegionImage` draws it: its outline and number in its state's look, named by the kind it counts as. */
function shapeOf(region: Region, codebook: Codebook | null): RegionShape {
  const look = REGION_LOOK[regionState(region)];
  return {
    id: region.regionId, ordinal: region.ordinal, polygon: region.polygon, box: region.box,
    tone: look.tone, edge: look.edge, wash: look.wash, label: kindName(countedKind(region), codebook),
  };
}

/** Verve's waiting surface in the item's shape, while the first batch is read. */
function QueueReading() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="grid gap-4 [@container(min-width:720px)]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <p role="status" className="sr-only">{t('affectedAreas.mark.reading')}</p>
      <div aria-hidden="true" className="vv-skeleton aspect-square w-full rounded-none" />
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="vv-skeleton h-3.5 w-1/2" />
        <div className="vv-skeleton h-7 w-4/5" />
        <div className="vv-skeleton h-4 w-full" />
        <div className="vv-skeleton h-9 w-3/4" />
      </div>
    </div>
  );
}

/**
 * THE MARK SCREEN, DRAWN: a queue the engine orders, one area at a time.
 *
 * The head: the queue's mode — Unsure first, said to be the fast way to find each kind's threshold, or Random slice,
 * said to be the honest measure — and the kind it is narrowed to (every kind by default). Then ONE AREA: the
 * question "Is this water stain?", where it is (the job, the room, the face) and how many are left; its view with
 * the area at full wash and the rest dimmed (`RegionImage`'s `focusId`); the reader's own name for it, its evidence
 * in quotes, how sure it was beside the kind's threshold, and whether it is held out to measure the reader; then
 * `MarkBar` — the very presses the pano screen offers, each carrying its key here (Y, R, N) — and Skip with S. The keys
 * are this screen's alone: on the pano screen a key would fire while a note is typed. Wide, the photo takes half the
 * width and the question, what the reader said and the presses stand beside it, above the fold; narrow, the question
 * comes first, then the photo, what the reader said, and the presses.
 *
 * States: the first batch out; the lane's fault (one banner, Try again); the queue spent ("Nothing left to mark",
 * the kind named when the queue is narrowed); an area whose pano has not answered yet (the area alone on its photo);
 * a queue of one ("1 left") and a thin one, drawn as any other with its count small.
 *
 * Handles: `data-mark-screen` (with `data-mark-mode`) on the screen, `data-mark-left` on the count, and on the bar
 * its own (`data-mark-bar`, `data-mark-press`), plus `data-mark-press="skip"`.
 *
 * Used by the affected-areas module's `MarkScreen`, which holds the queue and the screen's choices.
 */
export function MarkQueue({ codebook, mode, kind, walk, photo, onMode, onKind, onSkip, onMarked }: MarkQueueProps) {
  const { t } = useTranslation();
  const questionId = useId();
  const kinds = [
    { value: '', label: t('affectedAreas.mark.allKinds') },
    ...(codebook?.classes ?? []).map((entry) => ({ value: entry.key, label: entry.label, hint: t(`affectedAreas.groups.${entry.group}`) })),
  ];
  const item = walk.item;

  let body;
  if (walk.trouble !== null) {
    body = <LaneTrouble trouble={walk.trouble} subject="queue" onRetry={walk.retry} />;
  } else if (item === null && walk.left === null) {
    body = <QueueReading />;
  } else if (item === null) {
    const message = kind !== ''
      ? t('affectedAreas.mark.emptyKind', { kind: lowerFirst(kindName(kind, codebook)) })
      : t(mode === 'unsure' ? 'affectedAreas.mark.emptyUnsure' : 'affectedAreas.mark.emptyRandom');
    body = <EmptyState icon={CheckCheck} title={t('affectedAreas.mark.emptyTitle')} message={message} />;
  } else {
    const region = item.region;
    const faceName = t(`affectedAreas.faces.${item.view.face}`);
    const room = roomWords(item.roomName, null, false, t);
    // The area on judgment is the queue's own copy; its neighbours come from its view as the pano answered it.
    const neighbours = walk.regions.filter((other) => other.regionId !== region.regionId);
    const shapes = [...neighbours, region].sort((a, b) => a.ordinal - b.ordinal).map((each) => shapeOf(each, codebook));
    const facts = [
      region.confidence === null ? null : t('affectedAreas.region.sure', { percent: Math.round(region.confidence * 100) }),
      region.threshold === null ? t('affectedAreas.mark.noLine') : t('affectedAreas.mark.threshold', { percent: Math.round(region.threshold * 100) }),
      t(`affectedAreas.region.basis.${region.basis}`),
      region.holdout === true ? t('affectedAreas.mark.heldOut') : null,
    ].filter((part) => part !== null).join(' · ');

    // Wide, the photo and its answer split the width evenly, so the presses stand beside the photo above the fold —
    // the Tours view opens about 180 px down the Cerberus panel (measured at 1280 x 800) — and half the width fits
    // Confirm, Rename to… and Not a change on one row. Narrow: question, photo, what the reader said, then the presses.
    // The last row takes what the photo is taller than the rest.
    body = (
      <div className="grid min-w-0 items-start gap-x-6 gap-y-4 [@container(min-width:720px)]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [@container(min-width:720px)]:grid-rows-[auto_auto_1fr]">
        <div className="flex min-w-0 flex-col gap-1.5 [@container(min-width:720px)]:col-start-2 [@container(min-width:720px)]:row-start-1">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <p className="min-w-0 text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">
              {[item.jobLabel ?? t('affectedAreas.tour.unnamed'), room, t('affectedAreas.mark.faceView', { face: faceName })].join(' · ')}
            </p>
            <p className="flex-none text-[13px] font-semibold tabular-nums text-foreground" data-mark-left={walk.left ?? ''}>
              {t('affectedAreas.mark.left', { count: walk.left ?? 0 })}
            </p>
          </div>
          <h2 id={questionId} className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">
            {t('affectedAreas.mark.question', { kind: lowerFirst(kindName(region.class, codebook)) })}
          </h2>
        </div>

        <figure className="m-0 min-w-0 [@container(min-width:720px)]:col-start-1 [@container(min-width:720px)]:row-span-3 [@container(min-width:720px)]:row-start-1">
          <div className="ring-1 ring-border">
            <RegionImage
              src={photo}
              alt={t('affectedAreas.pano.photo', { face: faceName, room })}
              width={item.view.width}
              height={item.view.height}
              regions={shapes}
              focusId={region.regionId}
            />
          </div>
        </figure>

        <div className="flex min-w-0 flex-col gap-1 [@container(min-width:720px)]:col-start-2 [@container(min-width:720px)]:row-start-2">
          {region.label !== null && <p className="text-[14.5px] font-medium text-foreground [overflow-wrap:anywhere]">{region.label}</p>}
          {region.evidence !== null && region.evidence !== '' && (
            <p className="text-[13px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">“{region.evidence}”</p>
          )}
          <p className="text-xs text-muted-foreground">{facts}</p>
        </div>

        <section aria-labelledby={questionId} className="flex min-w-0 flex-col gap-3 [@container(min-width:720px)]:col-start-2 [@container(min-width:720px)]:row-start-3">
          <MarkBar key={region.regionId} region={region} codebook={codebook} queue={mode} onMarked={onMarked} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="max-md:h-11" aria-keyshortcuts="S" data-mark-press="skip" onClick={onSkip}>
              <SkipForward aria-hidden="true" />
              {t('affectedAreas.mark.skip')}
              <KeyCap letter="S" />
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5" data-mark-screen="" data-mark-mode={mode}>
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col items-start gap-1.5">
          <SegmentedControl<QueueMode>
            options={[
              { value: 'unsure', label: t('affectedAreas.mark.unsure') },
              { value: 'random', label: t('affectedAreas.mark.random') },
            ]}
            value={mode}
            onChange={onMode}
            label={t('affectedAreas.mark.modeLabel')}
          />
          <p className="max-w-[560px] text-[12.5px] leading-relaxed text-muted-foreground">
            {t(mode === 'unsure' ? 'affectedAreas.mark.unsureHint' : 'affectedAreas.mark.randomHint')}
          </p>
        </div>
        <div className="w-full min-w-0 [@container(min-width:560px)]:w-[248px] [@container(min-width:560px)]:flex-none">
          <Select options={kinds} value={kind} onChange={onKind} ariaLabel={t('affectedAreas.mark.kindLabel')} />
        </div>
      </header>
      {body}
    </div>
  );
}
