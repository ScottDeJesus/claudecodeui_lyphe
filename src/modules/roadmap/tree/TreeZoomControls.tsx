import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';

type TreeZoomControlsProps = {
  /** False at the tree's largest zoom: the `+` is then disabled. */
  canZoomIn: boolean;
  /** False at the fit: the `−` is then disabled. */
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Puts the zoom back at 1, the fit. */
  onFit: () => void;
};

/**
 * The tree's three zoom buttons — zoom in, zoom out, fit — small Verve icon buttons pinned in the corner of
 * the tree's `relative` wrapper, over the drawing and outside the pane's scroll, so they stay put while the
 * drawing moves under them. They are the way to zoom without a pinch or a `ctrl`+wheel (a mouse, a keyboard,
 * a switch), and each is named by an `aria-label`.
 *
 * Used by the roadmap module's tree, `tree/RoadmapTree`, as a child of its wrapper after the pane.
 */
export function TreeZoomControls({ canZoomIn, canZoomOut, onZoomIn, onZoomOut, onFit }: TreeZoomControlsProps) {
  const { t } = useTranslation();
  const buttonClass = 'h-8 w-8 bg-card';
  return (
    <div data-roadmap-zoom className="absolute right-2 top-2 z-10 flex gap-1">
      <Button type="button" variant="outline" size="icon" className={buttonClass} aria-label={t('roadmap.tree.zoomIn')} title={t('roadmap.tree.zoomIn')} disabled={!canZoomIn} onClick={onZoomIn}>
        <ZoomIn aria-hidden="true" />
      </Button>
      <Button type="button" variant="outline" size="icon" className={buttonClass} aria-label={t('roadmap.tree.zoomOut')} title={t('roadmap.tree.zoomOut')} disabled={!canZoomOut} onClick={onZoomOut}>
        <ZoomOut aria-hidden="true" />
      </Button>
      <Button type="button" variant="outline" size="icon" className={buttonClass} aria-label={t('roadmap.tree.fit')} title={t('roadmap.tree.fit')} onClick={onFit}>
        <Maximize aria-hidden="true" />
      </Button>
    </div>
  );
}
