import { useEffect, useRef } from 'react';

import { useLaneRead } from '@/modules/affected-areas/hooks/useLaneRead';
import { useWhenShown } from '@/modules/affected-areas/hooks/useViewShown';
import type { Proving, ProvingClass } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { AffectedAreasRead } from '@/shared/types';

/** The tables are one document for the pinned model on the current contract: their read has one key. */
const PROVING_KEY = 'proving';

/** The tables' read: module-level so `useLaneRead` sees the same function every render. */
const provingFor = () => api.affectedAreas.proving();

/**
 * THE PROVING TABLES (`GET /proving`): how right the reader is per kind and where each kind's line sits, read when the
 * Tables screen first shows. `shown` is whether the screen is on view; each time it turns true again the tables are
 * read again, quietly (the old table stays on screen until the new one lands), because the marks made on the Mark screen
 * and the pano screen move every number here. A person's press brings it back, never a timer.
 *
 * `replaceClass` puts the kind a Set threshold answered in place of its row: the engine answers the kind as it now
 * stands, so the line, its date and its figures are redrawn from the answer and nothing is worked out here. It outranks a
 * read of the tables begun before it, as `useLaneRead.replace` does for every press's answer.
 *
 * Used by the affected-areas module's `TablesScreen`.
 */
export function useProving(shown: boolean): AffectedAreasRead<Proving> & { replaceClass: (kind: ProvingClass) => void } {
  const read = useLaneRead<Proving>(PROVING_KEY, provingFor);
  useWhenShown(shown, read.reload);
  const table = read.value;
  // The tables as the latest render drew them: a Set threshold's answer lands seconds after the render that sent it, and
  // must go into the tables as they stand then (a quiet read may have landed between), not into the ones it was sent from.
  // A ref: nothing draws from it.
  const latestRef = useRef(table);
  useEffect(() => {
    latestRef.current = table;
  });

  return {
    value: table,
    trouble: read.trouble,
    retry: read.retry,
    replaceClass: (kind) => {
      const current = latestRef.current;
      if (current === null) return;
      read.replace({ ...current, classes: current.classes.map((candidate) => (candidate.class === kind.class ? kind : candidate)) }, PROVING_KEY);
    },
  };
}
