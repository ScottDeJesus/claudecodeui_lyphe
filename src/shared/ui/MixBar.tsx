import type { CSSProperties } from 'react';

import type { CompanionMaterial } from '@/shared/types';

type MixBarPart = {
  /** The part's key among its siblings. */
  key: string;
  /** Its name under the bar ("opus"). */
  label: string;
  /** Drawn in the mono face: a name the house prints as it is, such as a model's id. */
  mono?: boolean;
  /** How much of the whole it is, in any unit the parts share. */
  count: number;
  /** The same in the caller's words, after its name ("61"). */
  figure: string;
  /** The model whose colour it wears (the chats' coding); left off, the ink. */
  material?: CompanionMaterial;
};

type MixBarProps = {
  /** The parts, in the order they are drawn; the caller orders them. */
  parts: MixBarPart[];
  /** The bar's one spoken sentence ("Launches with Code Mode by model: opus 61, sonnet 58"). */
  label: string;
};

/**
 * Used by the analytics module's Code Mode glance: the launches with Code Mode, split by the model each ran on.
 *
 * ONE WHOLE IN ITS PARTS, as one bar: each part as long as its share, in its model's colour (the chats' coding, as a
 * chart wears it: `--chart-<material>`), the page's ground between two parts, and under the bar each part's name and
 * figure beside a dot of its colour, so no part is told by its colour alone. A part with nothing in it is named but draws
 * no length.
 *
 * The parts grow out from the left one after another on arrival, still under `prefers-reduced-motion`.
 *
 * Paint: `verve/readings.css`.
 */
export function MixBar({ parts, label }: MixBarProps) {
  return (
    <div className="vv-mixbar flex min-w-0 flex-col">
      <span className="vv-mixbar__bar flex" role="img" aria-label={label}>
        {parts
          .filter((part) => part.count > 0)
          .map((part, at) => (
            <span
              key={part.key}
              className="vv-mixbar__part"
              data-material={part.material}
              style={{ flexGrow: part.count, '--vv-mixbar-at': at } as CSSProperties}
            />
          ))}
      </span>
      <span className="vv-mixbar__keys flex flex-wrap" aria-hidden="true">
        {parts.map((part) => (
          <span key={part.key} className="vv-mixbar__key inline-flex min-w-0 items-baseline">
            <span className="vv-mixbar__dot" data-material={part.material} />
            <span className="vv-mixbar__name" data-mono={part.mono || undefined}>{part.label}</span>
            <span className="vv-mixbar__figure">{part.figure}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
