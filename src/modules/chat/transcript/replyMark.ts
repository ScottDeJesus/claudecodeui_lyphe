import type { CompanionMaterial } from '@/shared/types';

/**
 * The material a model wears, by the family its name carries: Opus the tube, Haiku the wire, Sonnet the plasma, and every other
 * model Mercury (`reading.css` gives a reply's mark each one's colour). One reading for the whole chat: the mark at a reply's head, the
 * chat's own core and the rings round it all ask here.
 *
 * Used by `MessageComponent` (the mark at the head of a turn that opens with something said), `WorkFold` (the mark on the line of
 * a turn that opens with work) and the composer's `ChatCore` (what the core is made of, and each stop on its model ring).
 */
export function replyMaterialOf(model: string): CompanionMaterial {
  const name = model.toLowerCase();
  if (name.includes('opus')) return 'tube';
  if (name.includes('haiku')) return 'wire';
  if (name.includes('sonnet')) return 'plasma';
  return 'mercury';
}
