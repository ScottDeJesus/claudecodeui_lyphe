import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * ONE SECTION OF THE ANALYTICS AREA, as the panel needs it: its id (the server's reader id, and the option's value on the
 * strip), the key of its name under `analytics.sections`, the windows it offers in days with the one it opens on, and its
 * `Body`, which is handed the chosen window and reads its own answer through `useAnalyticsSection` inside
 * `AnalyticsSectionFrame`. A section read as it stands now offers no window (`windows: []`): the panel draws no window
 * control for it and hands it its `defaultDays`. Every `Body` is also handed the panel's `openSection`, for a row that
 * points at another section.
 */
export type AnalyticsSection = {
  id: string;
  titleKey: string;
  windows: readonly number[];
  defaultDays: number;
  Body: LazyExoticComponent<ComponentType<{ days: number; openSection: (id: string) => void }>>;
};

/**
 * THE AREA'S SECTIONS, IN THE ORDER THE STRIP DRAWS THEM. The first row is where the area opens, and where a kept choice
 * the table no longer holds falls back to. A section is added whole by one row here: its folder under `sections/`, its
 * words under `analytics.`, and each `Body` lazy, so a section nobody opens is never downloaded.
 */
export const ANALYTICS_SECTIONS: AnalyticsSection[] = [
  {
    id: 'code-mode',
    titleKey: 'analytics.sections.codeMode',
    windows: [7, 30, 90],
    defaultDays: 30,
    Body: lazy(() => import('@/modules/analytics/sections/code-mode/CodeModeSection').then((m) => ({ default: m.CodeModeSection }))),
  },
  {
    id: 'web-walk',
    titleKey: 'analytics.sections.webWalk',
    windows: [7, 30, 90],
    defaultDays: 30,
    Body: lazy(() => import('@/modules/analytics/sections/web-walk/WebWalkSection').then((m) => ({ default: m.WebWalkSection }))),
  },
  {
    id: 'repeats',
    titleKey: 'analytics.sections.repeats',
    windows: [7, 30, 90],
    defaultDays: 30,
    Body: lazy(() => import('@/modules/analytics/sections/repeats/RepeatsSection').then((m) => ({ default: m.RepeatsSection }))),
  },
  {
    id: 'rnd',
    titleKey: 'analytics.sections.rnd',
    windows: [],
    defaultDays: 30,
    Body: lazy(() => import('@/modules/analytics/sections/rnd/RndReadingsSection').then((m) => ({ default: m.RndReadingsSection }))),
  },
];
