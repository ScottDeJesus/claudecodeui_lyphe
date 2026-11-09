import { useSyncExternalStore } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type { CompanionMaterial } from '@/shared/types';

/** Every material her face can be drawn in, in the order her Settings card offers them. */
const MATERIALS: readonly CompanionMaterial[] = ['mercury', 'tube', 'wire'];

/**
 * The one reader of the `companionMaterial` preference: this module's CompanionFace draws her in it and her Settings card
 * (`CompanionMaterialSettings`) previews and changes it. A value this build does not know reads as Mercury.
 */
export function useCompanionMaterial(): { material: CompanionMaterial; setMaterial: (next: CompanionMaterial) => void } {
  const stored = useSyncExternalStore(subscribeToUserPreferences, () => readUserPreference<CompanionMaterial>('companionMaterial', 'mercury'));
  const material = MATERIALS.includes(stored) ? stored : 'mercury';
  return { material, setMaterial: (next) => writeUserPreference('companionMaterial', next) };
}
