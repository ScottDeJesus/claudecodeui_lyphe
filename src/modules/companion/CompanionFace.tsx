import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionAvatar } from '@/modules/companion/CompanionAvatar';
import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { useCompanionMaterial } from '@/modules/companion/hooks/useCompanionMaterial';
import { useCompanionPresence } from '@/modules/companion/hooks/useCompanionPresence';
import { useFaceSentences } from '@/modules/companion/hooks/useFaceInputs';
import type { CompanionFaceLook } from '@/shared/types';

type CompanionFaceProps = {
  /** The square she fills, in px: the disc's inside for the button, the station's own for her head and portrait. */
  size: number;
  /** Where the anchor she looks at lies from her, or null for none. The button gives it while she looks at something; the station gives none, for on the station she faces him. */
  look?: CompanionFaceLook | null;
};

/**
 * Her face bound to this page's provider, the one binding her button and the station draw. Consumed by this module's
 * `CompanionFab` (inside the disc, at the disc's size less its rim, with the look the disc is drawing) and by the station
 * module (her head and portrait, looking at no anchor).
 *
 * It reads what the face needs from the provider and from `useCompanionPresence`, the same presence the status line and the button's
 * label read (MAN-9089): her state, the page player's `analyser`, `level` and `progress` (stable functions, so a frame sixty times a
 * second redraws nothing in React), the sentences she says (`useFaceSentences`), the material he chose for her (`useCompanionMaterial`)
 * and her name as he set it, the default while the page has not read it. The drawing is `CompanionAvatar`'s: the Astrolabe instrument.
 */
export function CompanionFace({ size, look = null }: CompanionFaceProps) {
  const { t } = useTranslation();
  const { picture, voice, clientId, level, progress, mouth, analyser } = useCompanion();
  const presence = useCompanionPresence();
  const sentences = useFaceSentences({ picture, voice, clientId });
  const { material } = useCompanionMaterial();
  const faceVoice = useMemo(() => ({ level, progress, mouth, analyser }), [level, progress, mouth, analyser]);
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  return <CompanionAvatar presence={presence} voice={faceVoice} sentences={sentences} look={look} material={material} size={size} name={name} />;
}
