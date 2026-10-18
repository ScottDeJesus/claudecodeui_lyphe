import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { capitalized, listWords, spoken } from '@/modules/affected-areas/utils/tourModel';
import type { DryingEntry, MaterialEntry, RoomEntry } from '@/shared/affected-areas-types';
import type { Tone } from '@/shared/types';
import { Card } from '@/shared/ui';
import { formatShortDate } from '@/shared/utils';

type RoomDryingProps = {
  /** The pano's room as its tour lists it; null when the tour does not name the room. */
  room: RoomEntry | null;
};

/** The module's words are English only, so its numbers are set as English sets them: "99", "37.6". */
const NUMBER = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** A reading with its unit: "99%", "18 WME". */
function reading(value: number, unit: string | null): string {
  const figure = NUMBER.format(value);
  if (unit === null || unit === '') return figure;
  return unit === '%' ? `${figure}%` : `${figure} ${unit}`;
}

/**
 * One material as a sentence and its tone: "Drywall read 99%, goal 16% — wet." in warn, the same at or under its
 * goal "— dry." in positive; "Drywall removed." and a reading with no goal in neutral, since neither says wet or dry.
 * Null when the report carries no reading for it.
 */
function materialLine(material: MaterialEntry, t: TFunction): { text: string; tone: Tone } | null {
  const name = capitalized(spoken(material.materialClass));
  if (material.removed === true) return { text: t('affectedAreas.drying.removed', { material: name }), tone: 'neutral' };
  if (material.firstReading === null) return null;
  const first = reading(material.firstReading, material.unit);
  if (material.goal === null) return { text: t('affectedAreas.drying.materialNoGoal', { material: name, first }), tone: 'neutral' };
  const wet = material.firstReading > material.goal;
  return {
    text: t('affectedAreas.drying.material', {
      material: name, first, goal: reading(material.goal, material.unit), verdict: t(wet ? 'affectedAreas.drying.wet' : 'affectedAreas.drying.dry'),
    }),
    tone: wet ? 'warn' : 'positive',
  };
}

/** "Affected floor 38 SF, wall 44 SF and ceiling 50 SF.": the surfaces the report measured, a zero or a blank left out. */
function affectedLine(drying: DryingEntry, t: TFunction): string | null {
  const areas = ([['floor', drying.affectedFloorSf], ['wall', drying.affectedWallSf], ['ceiling', drying.affectedCeilingSf]] as const)
    .filter(([, sf]) => sf !== null && sf > 0)
    .map(([surface, sf]) => t('affectedAreas.drying.affectedArea', { surface: t(`affectedAreas.drying.surface.${surface}`), sf: Math.round(sf ?? 0) }));
  return areas.length === 0 ? null : t('affectedAreas.drying.affected', { areas: listWords(areas, t) });
}

/**
 * DRYING IN THIS ROOM: the room's numbers from the latest real drying report that names it, said in words rather
 * than tabled — "Drywall read 99%, goal 16% — wet." per material, each with a dot in its tone (warn when it read wet,
 * positive when it read dry), then "Affected wall 44 SF.", whether water rose above 18 inches, and which report.
 * A room no report names says so.
 *
 * The reading is the report's FIRST one: what the material read when drying began, which is what the photo is read
 * against. Used by the affected-areas module's `PanoScreen`, under the face's list.
 */
export function RoomDrying({ room }: RoomDryingProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const drying = room?.drying ?? null;
  const lines = drying === null ? [] : drying.materials.map((material) => materialLine(material, t)).filter((line) => line !== null);
  const affected = drying === null ? null : affectedLine(drying, t);

  return (
    <Card role="region" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5 px-[18px] py-4">
      <h3 id={headingId} className="text-xs uppercase tracking-[0.14em] text-ink-faint">{t('affectedAreas.drying.title')}</h3>
      {drying === null ? (
        <p className="text-[13.5px] text-muted-foreground">{t('affectedAreas.drying.none')}</p>
      ) : (
        <>
          {lines.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {lines.map((line) => (
                <li key={line.text} className="flex items-baseline gap-2 text-[13.5px] text-foreground">
                  <span data-tone={line.tone} aria-hidden="true" className="size-2 flex-none -translate-y-px rounded-full bg-tone-dot" />
                  {line.text}
                </li>
              ))}
            </ul>
          )}
          {affected !== null && <p className="text-[13.5px] text-foreground">{affected}</p>}
          {drying.above18Inches === true && <p className="text-[13.5px] text-foreground">{t('affectedAreas.drying.above18')}</p>}
          <p className="text-xs text-muted-foreground">{t('affectedAreas.drying.report', { date: formatShortDate(drying.reportDate) ?? drying.reportDate })}</p>
        </>
      )}
    </Card>
  );
}
