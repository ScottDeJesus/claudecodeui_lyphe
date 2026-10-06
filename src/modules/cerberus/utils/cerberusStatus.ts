import type { CerberusStatus } from '@/shared/cerberus-types';
import type { CerberusCellShape, Tone } from '@/shared/types';

/**
 * How one status is drawn. `tone` goes onto the mark as `data-tone`, and the `[data-tone]` rules
 * (`tokens.css`) give it that tone's soft, ink and dot. `glyph` carries the status without colour
 * (MAN-578): ✓ passing, ▲ needs a look, ✕ refused, — no reading, · switched off. `wordKey` is the
 * status word's key in `en/common.json`. `cell` is the shape of its minute cell and its service
 * square.
 */
type StatusLook = {
  tone: Tone;
  glyph: '✓' | '▲' | '✕' | '—' | '·';
  wordKey: `cerberus.status.${CerberusStatus}`;
  cell: CerberusCellShape;
};

/**
 * THE ONE STATUS TABLE. Every Cerberus status maps to its tone, glyph, word and cell, following the
 * spec's Table 1 (`design/cerberus/Cerberus Spec.dc.html`) and the prototype engine's `ST`
 * (`design/cerberus/cerberus-engine.js`):
 *
 * - `ok`: positive, a soft fill, ✓.
 * - `warn`: warn, outlined, ▲.
 * - `failing`: warn, solid, ▲. The spec's decision: something stopped working and a fix may bring it
 *   back, so it is amber.
 * - `denied`: danger, solid, ✕. The only red, kept for a command the warden refused or a credential
 *   that was refused. Adding a sixth tone for it is not allowed (MAN-739 rule 4).
 * - `not_enabled`: neutral, flat, ·. The service has the feature switched off. This is not Cerberus's
 *   mute, and it never needs you.
 * - `unknown`: neutral, dashed with no fill, —. No result within `staleAfter`, and never drawn as
 *   passing.
 * - `muted`: neutral, the raised `surface2` ground, —.
 * - `paused`: neutral, dashed, —. The node's warden is restarting for an update.
 *
 * `unknown` and `paused` share their tone, glyph and cell on purpose. Either way the minute has no
 * reading, and only the word says why: the tooltip, the pill, the sentence.
 *
 * Read by the marks (`StatusMarks.tsx`) and by any view that writes a status's word. Nothing else in
 * the module decides a status's tone, glyph or shape. A view that needs one reads it here.
 */
export const STATUS_TABLE: Record<CerberusStatus, StatusLook> = {
  ok: { tone: 'positive', glyph: '✓', wordKey: 'cerberus.status.ok', cell: 'soft' },
  warn: { tone: 'warn', glyph: '▲', wordKey: 'cerberus.status.warn', cell: 'outline' },
  failing: { tone: 'warn', glyph: '▲', wordKey: 'cerberus.status.failing', cell: 'solid' },
  denied: { tone: 'danger', glyph: '✕', wordKey: 'cerberus.status.denied', cell: 'solid' },
  not_enabled: { tone: 'neutral', glyph: '·', wordKey: 'cerberus.status.not_enabled', cell: 'flat' },
  unknown: { tone: 'neutral', glyph: '—', wordKey: 'cerberus.status.unknown', cell: 'dashed' },
  muted: { tone: 'neutral', glyph: '—', wordKey: 'cerberus.status.muted', cell: 'surface' },
  paused: { tone: 'neutral', glyph: '—', wordKey: 'cerberus.status.paused', cell: 'dashed' },
};
