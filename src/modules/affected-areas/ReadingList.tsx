import { Card } from '@/shared/ui';

/**
 * Verve's waiting surface in the shape of a list of areas, while the pano's regions are read.
 *
 * Used by the affected-areas module's `PanoScreen`.
 */
export function ReadingList() {
  return (
    <Card aria-hidden="true" className="flex flex-col gap-3 px-4 py-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-start gap-3">
          <div className="vv-skeleton h-6 w-[26px] flex-none rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="vv-skeleton h-4 w-2/5" />
            <div className="vv-skeleton h-3 w-4/5" />
          </div>
        </div>
      ))}
    </Card>
  );
}
