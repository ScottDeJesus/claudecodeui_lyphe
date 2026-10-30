import { useId, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionControls, CompanionFace, CompanionStatus, useCompanion, useCompanionPresence } from '@/modules/companion';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { CompanionPresence, StationRegionProps, StationTier } from '@/shared/types';
import { Banner } from '@/shared/ui';
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

/** Her name's type per tier: the largest words of her column with her face over them, beside her face below it. */
const NAME: Record<StationTier, string> = {
  wide: 'text-lg [@container_her_(min-height:62rem)]:text-xl',
  laptop: 'text-lg',
  narrow: 'text-base',
};

type StationHeadViewProps = {
  /** The arrangement: her face over her words on a wide screen, beside them on a laptop and below (a phone included). */
  tier: StationTier;
  /** Her name as he set it, the default while her picture loads. */
  name: string;
  /** What she is doing on this page (`useCompanionPresence`): the status line reads it, as her face does. */
  presence: CompanionPresence;
  /** Her face at the square the tier gives it, in px: `CompanionFace` on the page, `CompanionAvatar` on a fixture's presence. */
  face: (px: number) => ReactNode;
  /** Her controls in their station layout, aligned as the tier's form stands them: `CompanionControls` with `layout: 'line'`. */
  controls: (align: 'start' | 'center') => ReactNode;
  /** While her process has failed, the server's sentence for it (null when it gave none); null while it runs. */
  failure: { sentence: string | null } | null;
};

/**
 * HER HEAD, the top of her column on Kaylee Station: her face, her name, her one state in words, the failed process's banner,
 * and her controls. Everything in it is the companion module's own, drawn through its barrel: the status line is
 * `CompanionStatus` at the station's emphasis (the same table of words, in the same order, from the same presence as her
 * panel's line and her button's label, MAN-9089), the controls are `CompanionControls` in one line (every rule of MAN-9090
 * comes with them), and the face is the caller's `face`, the face she wears on her button.
 *
 * - WIDE, her column at least 62rem tall (a 1920×1080 screen): her face at 200 px, centred, over her name and the status
 *   line, the controls under them (two lines in a 420 px column, each centred under her). Shorter (a 1440×900 screen): her
 *   face at 132 px beside her name and the status line, the two centred as one, the controls centred under them. Read off her
 *   column's height (a container query), never a mode: measured at 1440×900, the 200 px form stood 402 px, 48% of her column,
 *   and held her conversation at its floor while a draft was docked; this form is 260 px.
 * - LAPTOP: her face at 132 px beside her name, the status line and the controls.
 * - NARROW, a phone included: her face at 72 px beside her name and the status line; the controls under them, across.
 *
 * A FAILED PROCESS is a warn `Banner` with the server's sentence right under the status line ("Stopped · your next message
 * starts her again"), as her panel says it, the sentence on the banner and the next step in the line. While her picture
 * loads the line says Loading… and every control waits. She faces him: no look turns her toward a rail.
 *
 * A pure view: `StationHead` below binds it, and `.verify/kaylee-station-shots.mjs` draws it on `fake/head.ts`'s pictures.
 */
export function StationHeadView({ tier, name, presence, face, controls, failure }: StationHeadViewProps) {
  const { t } = useTranslation();
  const nameId = useId();
  const { px, box } = FACE[tier];
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
 * state of hers and no frame (MAN-9089).
 */
export function StationHead({ tier }: StationRegionProps) {
  const { t } = useTranslation();
  const { picture, voice, saveSettings, interrupt, clear } = useCompanion();
  // The one state her face and the status line read, so the two cannot disagree (MAN-9089).
  const presence = useCompanionPresence();
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  return (
    <StationHeadView
      tier={tier}
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
          onModelChange={(model) => saveSettings({ model })}
          onLiveChange={(live) => saveSettings({ live })}
          onInterrupt={interrupt}
          onClear={clear}
        />
      )}
      failure={picture?.process.state === 'failed' ? { sentence: picture.process.error } : null}
    />
  );
}
