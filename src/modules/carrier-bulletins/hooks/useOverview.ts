import { api } from '@/shared/api';
import type { LeftOutCarrier, OverviewAnswer, OverviewRow } from '@/shared/carrier-bulletins-types';
import { useLaneRead } from '@/shared/hooks/useLaneRead';
import type { AffectedAreasRead } from '@/shared/types';

/** The overview has one read, so one key: `useLaneRead` reads when the key is set, which is when the view opens. */
const OVERVIEW_KEY = 'overview';

/**
 * The carriers named in the overview's `X-Left-Out` header, none when the header is absent. A header that is there and
 * cannot be read still says a carrier is missing, so it becomes one unnamed entry and never the silence it exists to
 * prevent (INV-2673: never derive from an absence).
 */
function leftOutOf(header: string | null): LeftOutCarrier[] {
  if (header === null) return [];
  try {
    const named: unknown = JSON.parse(header);
    if (Array.isArray(named) && named.length > 0) {
      return named.map((entry: { carrier?: unknown; reason?: unknown } | null) => ({
        carrier: typeof entry?.carrier === 'string' ? entry.carrier : '',
        reason: typeof entry?.reason === 'string' ? entry.reason : '',
      }));
    }
  } catch (failure) {
    console.warn('The overview named carriers it left out in a header that could not be read', failure);
  }
  return [{ carrier: '', reason: '' }];
}

/**
 * The overview's read as the one answer `useLaneRead` hands on: the body's rows and the header's left-out carriers,
 * re-wrapped as one JSON body because the shared hook reads the body alone. A refused answer goes through untouched,
 * and a body that is not JSON throws here, which the hook tells as an answer CloudCLI cannot read. Module-level so
 * `useLaneRead` sees the same function every render.
 */
async function overviewFor(): Promise<Response> {
  const response = await api.carrierBulletins.overview();
  if (!response.ok) return response;
  const rows = (await response.json()) as OverviewRow[];
  const answer: OverviewAnswer = { rows, left_out: leftOutOf(response.headers.get('x-left-out')) };
  return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Every carrier's current file and how far it is read (`rows`), with the carriers the engine could not plan and so left
 * out of them (`left_out`): the overview screen's list and its warning, and the header the carrier's pages and a page
 * draw from at once. Read when the view first opens, and again only on a press (Refresh, Try again, or Back to the
 * overview): never on a timer.
 *
 * Used by the carrier-bulletins module's view root.
 */
export function useOverview(): AffectedAreasRead<OverviewAnswer> & { reload: () => void } {
  return useLaneRead<OverviewAnswer>(OVERVIEW_KEY, overviewFor);
}
