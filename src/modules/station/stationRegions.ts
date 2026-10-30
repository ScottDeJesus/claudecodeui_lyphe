import type { ComponentType } from 'react';

import type { StationRegionProps, StationSlot } from '@/shared/types';

/**
 * THE REGISTRY OF THE STATION'S REGIONS: for each slot of the layout, the component that fills it, handed the window's
 * `tier`. A slot with no line draws nothing, and the layout closes up around it, so a region lands live the moment its line
 * is added here — no flag, no switch-over. Empty now: each region plan (the sessions list, her face and conversation, the
 * needs rail, the memory corner, the strip) adds its own line, and none edits another's.
 *
 * Read by `StationShell`, which draws each registered region in its slot.
 */
export const STATION_REGIONS: Partial<Record<StationSlot, ComponentType<StationRegionProps>>> = {};
