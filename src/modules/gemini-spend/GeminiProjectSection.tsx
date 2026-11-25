import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { GeminiFeatureRow } from '@/modules/gemini-spend/GeminiFeatureRow';
import { switchId } from '@/modules/gemini-spend/geminiFigures';
import { GeminiRows } from '@/modules/gemini-spend/GeminiRow';
import type { FeatureRow, GeminiDoor } from '@/modules/gemini-spend/types';
import { Badge, EmptyState, Rule } from '@/shared/ui';

type GeminiProjectSectionProps = {
  /** restorly, shadowconnector or cloudcli: the section's name on the page, for a probe to find it by. */
  section: string;
  title: string;
  /** The project's estimated dollars over the window, at the rule's end. */
  figure: string;
  /** Restorly's own switch reads off. */
  masterOff?: boolean;
  /** The door these features are switched at. */
  door: GeminiDoor;
  features: FeatureRow[];
  held: ReadonlySet<string>;
  onSwitch: (door: GeminiDoor, feature: string, enabled: boolean) => void;
};

/**
 * One project of the Gemini view: Restorly, shadow-connector or CloudCLI, headed by its name and its figure, listing
 * its features in the door's own order. A master that reads off is said once, under the head, with what it means for
 * the switches below: they keep their own positions, and none of them asks while it is off.
 */
export function GeminiProjectSection({ section, title, figure, masterOff = false, door, features, held, onSwitch }: GeminiProjectSectionProps) {
  const { t } = useTranslation();
  const headingId = useId();
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-gemini-section={section}>
      <Rule id={headingId} end={figure}>
        {title}
      </Rule>
      {masterOff && (
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground" data-gemini-master-off>
          <Badge as="span" tone="warn" className="text-xs">
            <span aria-hidden="true">▲</span>&nbsp;{t('api.gemini.projects.masterOff')}
          </Badge>
          <span className="min-w-0">{t('api.gemini.projects.masterOffNote')}</span>
        </p>
      )}
      {features.length === 0 ? (
        <EmptyState size="sm" title={t('api.gemini.projects.empty')} />
      ) : (
        <GeminiRows>
          {features.map((row) => (
            <GeminiFeatureRow key={row.feature} row={row} held={held.has(switchId(door, row.feature))} onSwitch={(enabled) => onSwitch(door, row.feature, enabled)} />
          ))}
        </GeminiRows>
      )}
    </section>
  );
}
