import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionAvatar } from '@/modules/companion/CompanionAvatar';
import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { useCompanionPresence } from '@/modules/companion/hooks/useCompanionPresence';
import { useFaceSentences } from '@/modules/companion/hooks/useFaceInputs';
import type { CompanionFaceLook } from '@/shared/types';

type CompanionFaceProps = {
  /** The square she fills, in px: the disc's inside for the button, the station's own for her head. */
  size: number;
  /** Where the anchor she looks at lies from her, or null for none. The button gives it while she looks at something; the station gives none, for on the station she faces him. */
  look?: CompanionFaceLook | null;
};

/**
 * Her face bound to this page's provider, the one binding her button and the station draw. Consumed by this module's
 * `CompanionFab` (inside the disc, at the disc's size less its rim, with the look the disc is drawing) and by the station
 * module (her head, looking at no anchor).
 *
 * It reads what the face needs from the provider and from `useCompanionPresence`, the same presence the status line and the button's
 * label read (MAN-9089): her state, her `picture.face.id`, the page player's `level` and `progress` (stable functions, so a level sixty
 * times a second redraws nothing in React), the sentences she says (`useFaceSentences`), and her name as he set it, the default while
 * the page has not read it. The drawing is `CompanionAvatar`'s.
 */
export function CompanionFace({ size, look = null }: CompanionFaceProps) {
  const { t } = useTranslation();
  const { picture, voice, clientId, level, progress } = useCompanion();
  const presence = useCompanionPresence();
  const sentences = useFaceSentences({ picture, voice, clientId });
  const faceVoice = useMemo(() => ({ level, progress }), [level, progress]);
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  return (
    <CompanionAvatar presence={presence} faceId={picture?.face.id ?? null} voice={faceVoice} sentences={sentences} look={look} size={size} name={name} />
  );
}
