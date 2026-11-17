/**
 * The material a reply's mark wears, by the family its model's name carries: Opus the tube, Haiku the wire, every other model
 * Mercury (`reading.css` gives each its colour). The same reading the chat's core makes of the model it runs on.
 *
 * Used by `MessageComponent` (the mark at the head of a turn that opens with something said) and `WorkFold` (the mark on the line of
 * a turn that opens with work).
 */
export function replyMaterialOf(model: string): 'mercury' | 'tube' | 'wire' {
  const name = model.toLowerCase();
  if (name.includes('opus')) return 'tube';
  if (name.includes('haiku')) return 'wire';
  return 'mercury';
}
