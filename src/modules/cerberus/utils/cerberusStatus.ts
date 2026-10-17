import type { LucideIcon } from 'lucide-react';
import { BellOff, CircleCheck, CircleDashed, CirclePause, Clock, OctagonAlert, OctagonX, TriangleAlert, Wrench } from 'lucide-react';

import type { CerberusStatus } from '@/shared/cerberus-types';
import type { CerberusCellShape, CerberusMark, FleetStatus, Tone } from '@/shared/types';

/**
 * How one status is drawn. `tone` goes onto the mark as `data-tone`, and the `[data-tone]` rules
 * (`tokens.css`) give it that tone's soft, ink and dot. `icon` (lucide, the house set) carries the
 * status without colour (MAN-578), and its outline alone tells the three that need you apart: a crossed
 * octagon is refused, an octagon with an exclamation mark is failing, a triangle with one is close to
 * the limit. `wordKey` is the status word's key in `en/common.json`. `cell` is the shape of its minute
 * cell and its service square.
 */
type StatusLook = {
  tone: Tone;
  icon: LucideIcon;
  wordKey: `cerberus.status.${CerberusStatus}`;
  cell: CerberusCellShape;
};

/**
 * THE ONE STATUS TABLE. Every Cerberus status maps to its tone, icon, word and cell. Tone and cell follow
 * the spec's Table 1 (`design/cerberus/Cerberus Spec.dc.html`) and the prototype engine's `ST`
 * (`design/cerberus/cerberus-engine.js`); each icon is chosen so its shape reads without its colour:
 *
 * - `ok`: positive, a soft fill, `CircleCheck`.
 * - `warn`: warn, outlined, `TriangleAlert`.
 * - `failing`: warn, solid, `OctagonAlert`. The spec's decision: something stopped working and a fix may
 *   bring it back, so it is amber. The octagon, not a colour, sets it apart from `warn`'s triangle.
 * - `denied`: danger, solid, `OctagonX`. The only red, kept for a command the warden refused or a
 *   credential that was refused. Adding a sixth tone for it is not allowed (MAN-739 rule 4).
 * - `not_enabled`: neutral, flat, `CircleDashed`. The service has the feature switched off. This is not
 *   Cerberus's mute, and it never needs you.
 * - `unknown`: neutral, dashed with no fill, `Clock`: no result within `staleAfter`, and never drawn as
 *   passing.
 * - `muted`: neutral, the raised `surface2` ground, `BellOff`.
 * - `paused`: neutral, dashed, `CirclePause`. The node's warden is restarting for an update.
 *
 * `unknown` and `paused` share their tone and cell on purpose: either way the minute has no reading. The
 * icon says why where a mark has room for one, and the word always does: the tooltip, the pill, the sentence.
 *
 * Read by the marks (`StatusMarks.tsx`) and by any view that writes a status's word. Nothing else in
 * the module decides a status's tone, icon or shape. A view that needs one reads it here.
 */
export const STATUS_TABLE: Record<CerberusStatus, StatusLook> = {
  ok: { tone: 'positive', icon: CircleCheck, wordKey: 'cerberus.status.ok', cell: 'soft' },
  warn: { tone: 'warn', icon: TriangleAlert, wordKey: 'cerberus.status.warn', cell: 'outline' },
  failing: { tone: 'warn', icon: OctagonAlert, wordKey: 'cerberus.status.failing', cell: 'solid' },
  denied: { tone: 'danger', icon: OctagonX, wordKey: 'cerberus.status.denied', cell: 'solid' },
  not_enabled: { tone: 'neutral', icon: CircleDashed, wordKey: 'cerberus.status.not_enabled', cell: 'flat' },
  unknown: { tone: 'neutral', icon: Clock, wordKey: 'cerberus.status.unknown', cell: 'dashed' },
  muted: { tone: 'neutral', icon: BellOff, wordKey: 'cerberus.status.muted', cell: 'surface' },
  paused: { tone: 'neutral', icon: CirclePause, wordKey: 'cerberus.status.paused', cell: 'dashed' },
};

/**
 * How a fix's run is drawn, by where it stands: `going` (no result yet), then each result. `tone` goes on
 * as `data-tone`; `icon` carries it without colour (MAN-578): `Wrench` going; `CircleCheck` ok;
 * `TriangleAlert` failed or timed out — the fix did not do its part, which a person can look into; and
 * `OctagonX` refused, the only red: a command the warden would not run because no catalog it acked holds
 * it. Each ended run wears the icon of the status it reads like (`ok`, `warn`, `denied`), so a run and a
 * check never draw one state two ways. A refusal is the run's outcome, never a check's status, so it is
 * not a row of the status table above.
 *
 * Read by the Needs-you card's run strip (`NeedFix`), the sheet's Fix output (`FixOutput`) and the diagnosis
 * panel (`DiagnosisPanel`: its Failed pill and its one-off's ran line), so a run reads the same on the card
 * and in the sheet.
 */
export const RUN_LOOK: Record<'going' | 'ok' | 'failed' | 'timed_out' | 'refused', { tone: Tone; icon: LucideIcon }> = {
  going: { tone: 'info', icon: Wrench },
  ok: { tone: 'positive', icon: CircleCheck },
  failed: { tone: 'warn', icon: TriangleAlert },
  timed_out: { tone: 'warn', icon: TriangleAlert },
  refused: { tone: 'danger', icon: OctagonX },
};

/**
 * How the fleet draws a node or a service with a fix running (`fixing`; `design/cerberus/cerberus-fleet.js`
 * :10 and :18): a running fix's tone and wrench (`RUN_LOOK.going`), on the `solid` cell, so every paint map
 * keyed by cell shape draws it as the prototype does — a node's tile edged 1.5px in the info dot
 * (`TILE_EDGE`), its ring dot and a service's square filled with it (`DOT_PAINT`, `StatusSquare`), a
 * service's pill in the info tone. Its mark pulses (`glyphMotion`, `vv-pulse` 1.4 s) where a failing
 * one rings: a fix is already on it. Its words go by who started the run: "Fix running on its own" /
 * "Fix running" (`cerberus.fix.fleet.runningAuto` / `.running`); the rings' key says "Fix running or
 * updating" (`cerberus.fix.fleet.legend`). `wordKey` is the bare "Fix running", the name a mark carries
 * to assistive tech when no sentence names it.
 *
 * Fed from `overview.running` (`fleetModel`): a node and a service with a run going on one of its checks.
 * Read through `markLook`, with every status.
 */
export const FLEET_FIXING_LOOK: { tone: Tone; icon: LucideIcon; cell: CerberusCellShape; wordKey: string; glyphMotion: string } = {
  tone: RUN_LOOK.going.tone,
  icon: RUN_LOOK.going.icon,
  cell: 'solid',
  wordKey: 'cerberus.fix.fleet.running',
  glyphMotion: 'motion-safe:animate-[vv-pulse_1.4s_ease-in-out_infinite]',
};

/** How a mark is painted: a status's row of the table, or the fixing look. `wordKey` names it to assistive tech. */
type MarkLook = { tone: Tone; icon: LucideIcon; cell: CerberusCellShape; wordKey: string };

/**
 * The look a mark is painted from: `STATUS_TABLE`'s row for a status, `FLEET_FIXING_LOOK` for `fixing`.
 * Every mark of a node or a service reads it, so a fix running is the same info look — its wrench wherever
 * a mark has room for an icon — in a card, a square, a pill, a ring's dot and the key.
 */
export function markLook(mark: CerberusMark): MarkLook {
  return mark === 'fixing' ? FLEET_FIXING_LOOK : STATUS_TABLE[mark];
}

/**
 * The mark a NODE's word draws with, or `null` for a word with no mark. `empty` has none: nothing is on
 * the node to read. `fixing` is a fix running on the node: the info wrench, which pulses where a failing
 * node rings. `updating` is a warden update queued or running on it, and draws that same info wrench —
 * the rings' key says "Fix running or updating" of the one look — while `paused`, its warden mid-restart,
 * keeps the dashed neutral of its checks. `enrolling` is a held place, fed by nothing yet; whatever
 * feeds it gives its word a mark.
 *
 * Read by Fleet's node card (its round glyph and its tile's edge) and by the rings (each node's dot, its
 * label's icon, and the hub), so a node is drawn the same in every layout.
 */
export function nodeMark(status: FleetStatus): CerberusMark | null {
  if (status === 'empty' || status === 'enrolling') return null;
  return status === 'updating' ? 'fixing' : status;
}
