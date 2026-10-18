import { useLaneRead } from '@/modules/affected-areas/hooks/useLaneRead';
import type { Codebook } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';
import type { AffectedAreasRead } from '@/shared/types';

/** The codebook is one document: its read has one key. */
const CODEBOOK_KEY = 'codebook';

/** The codebook's read: module-level so `useLaneRead` sees the same function every render. */
const codebookFor = () => api.affectedAreas.codebook();

/**
 * The codebook: the kinds' labels ("Material removed") and the contract version a read is current under, read once
 * when the view first shows. Until it answers, a kind is spoken from its key and Read again offers no contract reason.
 *
 * Used by the affected-areas module's view root.
 */
export function useCodebook(): AffectedAreasRead<Codebook> {
  const read = useLaneRead<Codebook>(CODEBOOK_KEY, codebookFor);
  return { value: read.value, trouble: read.trouble, retry: read.retry };
}
