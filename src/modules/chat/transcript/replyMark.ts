import { modelMaterialOf } from '@/shared/modelLabels';
import type { CompanionMaterial } from '@/shared/types';

/**
 * The material a model wears in the chat: Opus the tube, Haiku the wire, Sonnet the plasma, and every other model Mercury
 * (`reading.css` gives a reply's mark each one's colour). It is the app's one colour coding (`modelMaterialOf`) under the chat's
 * own name: the mark at a reply's head, the chat's own core and the rings round it all ask here.
 *
 * Used by `MessageComponent` (the mark at the head of a turn that opens with something said), `WorkFold` (the mark on the line of
 * a turn that opens with work) and the composer's `ChatCore` (what the core is made of, and each stop on its model ring).
 */
export function replyMaterialOf(model: string): CompanionMaterial {
  return modelMaterialOf(model);
}
