import type { ReactNode } from 'react';

import type { CerberusView } from '@/shared/types';
import { ViewBoundary } from '@/shared/ui';

type KeptViewProps = {
  /** This view's id in the strip. */
  id: CerberusView;
  /** The view the strip shows now. */
  view: CerberusView;
  /** The views shown at least once (`useKeptViews`): this one mounts when its id first appears in it. */
  shownOnce: ReadonlySet<CerberusView>;
  /** The view's name as its tab words it ("Tours"): the tabpanel's name, and what its boundary calls it when it cannot load. */
  label: string;
  /** The lazy view. */
  children: ReactNode;
};

/**
 * A lazy view the tab keeps mounted: it mounts on its first show, is `hidden` rather than unmounted once left, and its
 * place survives a visit to another view (the scroll through `useKeptViews`; the open tour, carrier and page are its own
 * state). Nothing on the wrapper sets a display, so `hidden` takes it out of layout. The view's code is its own chunk,
 * loaded on its first show, and the surround keeps a chunk that fails to load from taking the rest of the tab with it.
 *
 * Used by the cerberus module's `CerberusPanel`, around the Tours view and the Bulletins view.
 */
export function KeptView({ id, view, shownOnce, label, children }: KeptViewProps) {
  if (!shownOnce.has(id)) return null;
  return (
    <div role="tabpanel" aria-label={label} hidden={view !== id}>
      <ViewBoundary view={label}>{children}</ViewBoundary>
    </div>
  );
}
