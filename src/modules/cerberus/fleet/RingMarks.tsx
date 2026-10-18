import { useTranslation } from 'react-i18next';

import { MarkIcon } from '@/modules/cerberus/StatusMarks';
import { FLEET_FIXING_LOOK, markLook, nodeMark, STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import type { CerberusCellShape, FleetItem, FleetStatus } from '@/shared/types';
import { cn } from '@/shared/utils';

/*
 * THE RINGS' MARKS: a node's dot, center's round, and the key that explains them. Each reads the one
 * status table through `nodeMark`, so a node is drawn in its word's tone and shape here as in its card.
 * Tone reaches paint only as `data-tone` plus a `tone-*` name. The key draws its swatches with the same
 * dot, so it can never drift from the rings it explains.
 */

/**
 * A node's dot, by its word's cell shape in the one table. Passing and close to the limit share a shape,
 * a wash inside the tone's edge, as the prototype draws them: a lone dot needs its edge to be seen at all
 * (a strip's passing minute does not), and the hue and the label's icon, a circled check against a
 * triangle, tell the two apart.
 * Failing and refused are filled. No result is a hollow dashed round, grounded on the card so its spoke
 * stops at the edge. Muted is the raised grey inside the neutral dot's solid edge: the strip's
 * `border-input` edge measured 1.41:1 on the light card, and a lone dot needs 3:1 to be found as a node.
 * Not enabled is never a node's word (`nodeMark`); it keeps the strip's paint so the table stays whole.
 */
const DOT_PAINT: Record<CerberusCellShape, string> = {
  soft: 'border-[1.5px] border-tone-dot bg-tone-soft',
  outline: 'border-[1.5px] border-tone-dot bg-tone-soft',
  solid: 'border-[1.5px] border-tone-dot bg-tone-dot',
  flat: 'border-[1.5px] border-transparent bg-tone-dot/35',
  dashed: 'border-[1.5px] border-dashed border-tone-dot bg-card',
  surface: 'border-[1.5px] border-tone-dot bg-muted',
};

/**
 * A node whose word has no mark (nothing assigned yet, as every newly enrolled node starts): a hollow round
 * in the neutral dot's solid edge, drawn under `data-tone="neutral"`. The strong border measured 1.41:1 on
 * the light card, and the neutral ink kept dashed would read as no result.
 */
const UNMARKED_DOT = 'border-[1.5px] border-tone-dot bg-card';

/**
 * The hub's round holds its name, so it is never filled with the dot. Passing keeps the card's ground
 * inside the tone's edge, the prototype's hub at rest; any other word takes its wash.
 */
const HUB_PAINT: Record<CerberusCellShape, string> = {
  soft: 'border-[1.5px] border-tone-dot bg-card',
  outline: 'border-[1.5px] border-tone-dot bg-tone-soft',
  solid: 'border-[1.5px] border-tone-dot bg-tone-soft',
  flat: 'border-[1.5px] border-border bg-card',
  dashed: 'border-[1.5px] border-dashed border-tone-dot bg-tone-soft',
  surface: 'border-[1.5px] border-tone-dot bg-muted',
};
const UNMARKED_HUB = 'border-[1.5px] border-tone-dot bg-card';

/** The selected node, or the selected hub: an ink ring standing off the mark by the card's ground. */
const SELECTED_RING = 'ring-2 ring-foreground ring-offset-2 ring-offset-card';

/**
 * A node as a round dot: its word's shape (`DOT_PAINT`), its tone through `data-tone`. While the node is
 * failing the dot rings with `cerberus-ring-warn`, the halo its glyph wears in the cards; selected, it
 * wears the ink ring instead, as both are a box-shadow. A fix running is the info dot, filled, and it
 * pulses in the ring's place. It swells under a hovered `group`, the button the
 * rings wrap it in. `still` is for the key, whose swatch explains a look and must not ask for one. The
 * dot is decoration: the button around it, or the key's words beside it, name it.
 *
 * Used by Fleet's `FleetRings`, once per node on its rings, and by the key below.
 */
export function RingDot({ status, size, selected = false, still = false }: {
  status: FleetStatus;
  /** Its diameter in pixels: the layout's dot for the density of the fleet and the size of the box. */
  size: number;
  selected?: boolean;
  still?: boolean;
}) {
  const mark = nodeMark(status);
  const look = mark === null ? null : markLook(mark);
  return (
    <span
      aria-hidden
      data-tone={look?.tone ?? 'neutral'}
      style={{ width: size, height: size }}
      className={cn(
        'block flex-none rounded-full transition-transform duration-[400ms] ease-spring group-hover:scale-150',
        look === null ? UNMARKED_DOT : DOT_PAINT[look.cell],
        selected && SELECTED_RING,
        mark === 'failing' && !selected && !still && 'motion-safe:animate-cerberus-ring-warn',
        mark === 'fixing' && !selected && !still && FLEET_FIXING_LOOK.glyphMotion,
      )}
    />
  );
}

/**
 * CENTER, the hub at the middle of the rings, drawn as the prototype draws it: a round lifted off the
 * card, a fifth of the box across (66 to 92 px), holding the icon of its word, its name, and "Cerberus"
 * in the display face. It springs a little larger under the pointer and smaller under the press. A press
 * selects it like any node, and it wears the ink ring while selected.
 *
 * Used by Fleet's `FleetRings`, at the centre of its box.
 */
export function RingHub({ hub, selected, label, onPress }: {
  hub: FleetItem;
  selected: boolean;
  /** Its name and its one line ("center · cerberus/disk.free — close to the limit"), for assistive tech. */
  label: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const mark = nodeMark(hub.status);
  const look = mark === null ? null : markLook(mark);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={t('cerberus.fleet.rings.hubTitle', { name: hub.id })}
      onClick={onPress}
      data-tone={look?.tone ?? 'neutral'}
      className={cn(
        'absolute left-1/2 top-1/2 z-[2] flex aspect-square w-[clamp(66px,19%,92px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-px rounded-full px-1 shadow-md',
        'transition-transform duration-[450ms] ease-spring hover:scale-[1.06] active:scale-95',
        look === null ? UNMARKED_HUB : HUB_PAINT[look.cell],
        selected && SELECTED_RING,
      )}
    >
      {look !== null && <MarkIcon icon={look.icon} className="size-3 text-tone-ink" />}
      <span className="max-w-full truncate text-[15px] font-bold leading-tight tracking-[-0.01em]">{hub.id}</span>
      <span className="font-serif text-sm italic leading-tight text-accent-ink">{t('cerberus.fleet.rings.hubSub')}</span>
    </button>
  );
}

/** The key's rows: a look, drawn by the dot the rings draw, and the words that name it. */
const KEY: { status: FleetStatus; wordKey: string }[] = [
  { status: 'ok', wordKey: STATUS_TABLE.ok.wordKey },
  { status: 'failing', wordKey: 'cerberus.fleet.rings.legend.needs' },
  // Second after Needs you, as the prototype's key orders it (`Cerberus Tab.dc.html` :273); the updates plan's
  // `enrolling` shares this row and its words.
  { status: 'fixing', wordKey: 'cerberus.fix.fleet.legend' },
  { status: 'unknown', wordKey: 'cerberus.fleet.rings.legend.unknown' },
  { status: 'muted', wordKey: STATUS_TABLE.muted.wordKey },
];

/**
 * THE KEY, beside the rings while nothing is selected: "Every warden reports to center", how to read the
 * rings, then each look a dot takes with its words.
 *
 * Used by Fleet's `FleetRings`, in place of a selected node's panel.
 */
export function RingsKey() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border-[1.5px] border-dashed border-input px-[18px] py-4">
      <h3 className="font-serif text-[21px] italic leading-[1.2]">{t('cerberus.fleet.rings.legend.title')}</h3>
      <p className="text-[13px] leading-[1.55] text-muted-foreground">{t('cerberus.fleet.rings.legend.body')}</p>
      <ul className="m-0 flex list-none flex-col gap-[7px] p-0 text-[12.5px] text-secondary-foreground">
        {KEY.map(({ status, wordKey }) => (
          <li key={status} className="flex items-center gap-2.5">
            <RingDot status={status} size={12} still />
            {t(wordKey)}
          </li>
        ))}
      </ul>
    </section>
  );
}
