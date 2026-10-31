import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useId, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionControls, CompanionFace, CompanionStatus, useCompanion, useCompanionPresence } from '@/modules/companion';
import { HeadRow } from '@/modules/station/HeadRow';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { CompanionPresence, StationDensity, StationHeadRow, StationRegionProps, StationTier } from '@/shared/types';
import { Banner, buttonVariants, Menu } from '@/shared/ui';
import { cn, resizeObserverIn } from '@/shared/utils';

/**
 * Her face's square per tier: the px her face is drawn at, and the class that sizes its box. Fixed per tier, never grown: growth
 * is her button's, not her head's. On a wide screen the box is 200 px while her column is at least 62rem tall (the container
 * query `her`, StationShell's column) and 132 px below that; the face fills its box by CSS, and her initial (a box whose face
 * is not made yet) is drawn at the px the view reads off the box as it lays out, starting from the px given here.
 */
const FACE: Record<StationTier, { px: number; box: string }> = {
  wide: { px: 132, box: 'size-[132px] [@container_her_(min-height:62rem)]:size-[200px]' },
  laptop: { px: 132, box: 'size-[132px]' },
  narrow: { px: 72, box: 'size-[72px]' },
};

/** Her face at compact density, at every tier: one column has no height to give a larger one. */
const COMPACT_FACE = { px: 64, box: 'size-16' };

/** Her face in the phone's top row (`HeadRow`): 44 px upright, 32 px on its side, where the row is 40 px. */
const ROW_FACE = { upright: { px: 44, box: 'size-11' }, sideways: { px: 32, box: 'size-8' } };

/**
 * The most the panel her controls hang in takes at compact: two lines of `CompanionControls`' line, Stop, the model and Live over
 * the voice and Clear, with their 44 px catches below 768 px (measured at 390 px: at 360 Live stood alone on a third line while
 * Stop led); given her ears, three, the voice alone over her ears and Clear (`.verify/kaylee-ears-scaffold.mjs`, every word inside
 * at 390 and 1440 px). A window narrower than it less 16 px narrows it, and its controls wrap. The panel opens under the press, which
 * stands under her words, so its top is below her face's foot at every width and an edge shift to the left never covers her.
 */
const CONTROLS_PANEL_PX = 380;

/** Her name's type per tier: the largest words of her column with her face over them, beside her face below it. */
const NAME: Record<StationTier, string> = {
  wide: 'text-lg [@container_her_(min-height:62rem)]:text-xl',
  laptop: 'text-lg',
  narrow: 'text-base',
};

type StationHeadViewProps = {
  /** The arrangement: her face over her words on a wide screen, beside them on a laptop and below (a phone included). */
  tier: StationTier;
  /** `compact` draws the one-column head, the same at every tier: her face at 64 px, her controls behind "Her controls". */
  density: StationDensity;
  /** Her name as he set it, the default while her picture loads. */
  name: string;
  /** What she is doing on this page (`useCompanionPresence`): the status line reads it, as her face does. */
  presence: CompanionPresence;
  /** Her face at the square the tier (or compact density) gives it, in px: `CompanionFace` on the page, `CompanionAvatar` on a fixture's presence. */
  face: (px: number) => ReactNode;
  /**
   * Her controls in their station layout, aligned as the tier's form stands them: `CompanionControls` with `layout: 'line'`. At
   * compact density, drawn inside the "Her controls" panel while it is open.
   */
  controls: (align: 'start' | 'center') => ReactNode;
  /** While her process has failed, the server's sentence for it (null when it gave none); null while it runs. */
  failure: { sentence: string | null } | null;
  /**
   * Her head as the phone's top row (`StationHeadRow`, handed by the phone's arrangement over `density: 'compact'`): her face at 44
   * px (32 on its side), her name and her state on one line, the arrangement's `trail`, and her one menu at the row's end, holding
   * her controls and "CloudCLI". Absent everywhere else.
   */
  row?: StationHeadRow;
};

/**
 * HER HEAD, the top of her column on Kaylee Station: her face, her name, her one state in words, the failed process's banner,
 * and her controls. Everything in it is the companion module's own, drawn through its barrel: the status line is
 * `CompanionStatus` at the station's emphasis (the same table of words, in the same order, from the same presence as her
 * panel's line and her button's label, MAN-9089), the controls are `CompanionControls` in one line (every rule of MAN-9090
 * comes with them), and the face is the caller's `face`, the face she wears on her button.
 *
 * - WIDE, her column at least 62rem tall (a 1920×1080 screen): her face at 200 px, centred, over her name and the status
 *   line, the controls under them (two lines in a 420 px column, three given her ears, each centred under her). Shorter (a
 *   1440×900 screen): her face at 132 px beside her name and the status line, the two centred as one, the controls centred under
 *   them. Read off her column's height (a container query), never a mode: measured at 1440×900, the 200 px form stood 402 px,
 *   48% of her column, and held her conversation at its floor while a draft was docked; this form is 260 px, and given her ears
 *   294 px, 322 px while their `unavailable` sentence runs to three lines (the ears scaffold's fixtures, 2026-10-30).
 * - LAPTOP: her face at 132 px beside her name, the status line and the controls.
 * - NARROW, a phone included: her face at 72 px beside her name and the status line; the controls under them, across.
 * - COMPACT DENSITY (the one-column arrangement, at any tier): her face at 64 px beside her name and the status line, the two on
 *   one line where they fit (the status drops under the name, whole, where they do not), and under them her controls behind
 *   ONE press, "Her controls": the kit `Menu`'s panel holding `CompanionControls`' line, every rule of theirs kept (Stop leads
 *   it while her turn runs). The press stands under her words, so the panel hangs from their left edge and never over her
 *   face, at every width. A failed process's banner takes the head's whole width under them.
 *
 * - THE PHONE'S TOP ROW (`row`, handed by the phone's arrangement; `HeadRow`): her face at 44 px (32 on its side), her name and
 *   her state on one line, the arrangement's `trail`, and her ONE menu at the row's end, her controls' line over "CloudCLI", the
 *   shell's way back in the same window. The station's title is not drawn: her name stands there.
 *
 * A FAILED PROCESS is a warn `Banner` with the server's sentence right under the status line ("Stopped · your next message
 * starts her again"), as her panel says it, the sentence on the banner and the next step in the line. While her picture
 * loads the line says Loading… and every control waits. She faces him: no look turns her toward a rail.
 *
 * A pure view: `StationHead` below binds it, and `.verify/kaylee-station-shots.mjs` draws it on `fake/head.ts`'s pictures.
 */
export function StationHeadView({ tier, density, name, presence, face, controls, failure, row }: StationHeadViewProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const compact = density === 'compact';
  const { px, box } = row !== undefined ? ROW_FACE[row.sideways ? 'sideways' : 'upright'] : compact ? COMPACT_FACE : FACE[tier];
  const hostWindow = useHostWindow();
  // Her face's box as drawn: state, so a head laid out again (a tier change keeps her column) is observed afresh.
  const [faceNode, setFaceNode] = useState<HTMLDivElement | null>(null);
  // The px her face's box is drawn at, read off the box (a ResizeObserver: an event), since on a wide screen her column's height,
  // which only the layout knows, makes it 132 or 200 px: her initial is drawn at it, so it fills the disc it stands in.
  const [drawnPx, setDrawnPx] = useState(px);
  useLayoutEffect(() => {
    if (faceNode === null) return undefined;
    const observer = resizeObserverIn(hostWindow, ([entry]) => { if (entry) setDrawnPx(Math.round(entry.contentRect.width)); });
    observer?.observe(faceNode);
    return () => observer?.disconnect();
  }, [faceNode, hostWindow]);

  const faceBox = (
    // The disc's own ground under her portrait, which shows only while its sheets decode.
    <div ref={setFaceNode} data-station-head-face="" className={cn('relative shrink-0 rounded-full bg-accent-soft', box)}>
      {face(drawnPx)}
    </div>
  );
  const words = (
    <div className={cn('flex min-w-0 max-w-full flex-col gap-0.5', tier === 'wide' && '[@container_her_(min-height:62rem)]:items-center')}>
      <h2 id={nameId} data-station-head-name="" className={cn('max-w-full truncate font-semibold leading-tight text-foreground', NAME[tier])}>
        {name}
      </h2>
      <CompanionStatus presence={presence} emphasis="station" />
    </div>
  );
  const banner = failure !== null && (
    <div data-station-head-failed="" className="w-full text-left">
      <Banner tone="warn">{failure.sentence ?? t('companion.panel.failedUnknown', { name })}</Banner>
    </div>
  );

  if (row !== undefined) {
    return (
      <HeadRow
        row={row}
        face={faceBox}
        name={name}
        nameId={nameId}
        presence={presence}
        controls={controls('start')}
        panelWidth={CONTROLS_PANEL_PX}
        banner={banner}
      />
    );
  }

  if (compact) {
    const controlsLabel = t('station.head.controls', { defaultValue: 'Her controls' });
    return (
      <section data-station-head="compact" aria-labelledby={nameId} className="flex min-w-0 flex-col gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          {faceBox}
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
            {/* Her name and her state on one line; the state wraps under the name, whole, where the two do not fit. */}
            <div className="flex min-w-0 max-w-full flex-wrap items-baseline gap-x-2.5">
              <h2 id={nameId} data-station-head-name="" className="max-w-full truncate text-base font-semibold leading-6 text-foreground">
                {name}
              </h2>
              <CompanionStatus presence={presence} emphasis="station" />
            </div>
            <Menu
              width={CONTROLS_PANEL_PX}
              label={controlsLabel}
              panel={controls('start')}
              trigger={(
                <span data-station-head-controls="" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'finger:h-11')}>
                  <SlidersHorizontal aria-hidden="true" />
                  {controlsLabel}
                  <ChevronDown aria-hidden="true" />
                </span>
              )}
            />
          </div>
        </div>
        {banner}
      </section>
    );
  }

  if (tier === 'wide') {
    return (
      <section data-station-head={tier} aria-labelledby={nameId} className="flex min-w-0 flex-col gap-3 p-4 [@container_her_(min-height:62rem)]:text-center">
        {/* Her face and her words: beside each other, centred as one, or (her column tall enough) her face over her words. */}
        <div className="flex min-w-0 items-center justify-center gap-4 [@container_her_(min-height:62rem)]:flex-col [@container_her_(min-height:62rem)]:gap-3">
          {faceBox}
          {words}
        </div>
        {banner}
        {/* The line wraps in her 420 px column: each of its lines centred under her, as her face and words are. */}
        {controls('center')}
      </section>
    );
  }

  if (tier === 'laptop') {
    return (
      <section data-station-head={tier} aria-labelledby={nameId} className="flex min-w-0 items-center gap-5 p-4">
        {faceBox}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {words}
          {banner}
          {controls('start')}
        </div>
      </section>
    );
  }

  return (
    <section data-station-head={tier} aria-labelledby={nameId} className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex min-w-0 items-center gap-3">
        {faceBox}
        {words}
      </div>
      {banner}
      {controls('start')}
    </section>
  );
}

/**
 * Her head on the page, the `head` slot's region (`stationRegions.ts`): it hands `StationHeadView` her face bound to this page's
 * provider at the tier's size, her presence, her controls bound to the provider's verbs, and her process's failure. It adds no
 * state of hers and no frame (MAN-9089). `row` passes through: the phone's arrangement draws this region as its top row.
 */
export function StationHead({ tier, density, row }: StationRegionProps & { row?: StationHeadRow }) {
  const { t } = useTranslation();
  const {
    picture, voice, ears, saveSettings, interrupt, clear,
  } = useCompanion();
  // The one state her face and the status line read, so the two cannot disagree (MAN-9089).
  const presence = useCompanionPresence();
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  return (
    <StationHeadView
      tier={tier}
      density={density}
      name={name}
      presence={presence}
      // She faces him: no look turns her toward a rail.
      face={(px) => <CompanionFace size={px} />}
      controls={(align) => (
        <CompanionControls
          name={name}
          picture={picture}
          presence={presence}
          layout="line"
          align={align}
          voice={voice}
          ears={ears}
          onModelChange={(model) => saveSettings({ model })}
          onLiveChange={(live) => saveSettings({ live })}
          onInterrupt={interrupt}
          onClear={clear}
        />
      )}
      failure={picture?.process.state === 'failed' ? { sentence: picture.process.error } : null}
      row={row}
    />
  );
}
