import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { ROADMAP_ALL_TOPIC, useLiveTopic } from '@/modules/live-bus';
import type { Roadmap, RoadmapPicture } from '@/shared/roadmap-types';
import {
  hasHydratedUserPreferences,
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

/**
 * What `useRoadmap` hands back: `picture` is `null` until the lane's first reading lands, and
 * `selected` is `null` until the preferences have settled as well. Read by the Roadmap tab's face and
 * picker (`RoadmapTab`, `RoadmapPath`, `RoadmapPicker`) and by the chat gutter's widget.
 */
export type RoadmapView = {
  picture: RoadmapPicture | null;
  roadmaps: Roadmap[];
  selected: Roadmap | null;
  select(name: string): void;
};

/** The roadmaps of a picture that has not landed — one array, so a consumer's memo does not see a new `[]` every render. */
const NO_ROADMAPS: Roadmap[] = [];

/**
 * The roadmap lane's read side: the whole picture off the live bus, the roadmaps it carries, and the
 * ONE of them on screen. Used by the Roadmap tab's face (`RoadmapPath`, `RoadmapTab`), by the picker
 * (`RoadmapPicker`) and by the chat gutter's widget (`RoadmapWidgetBody`), and — through the roadmap
 * barrel — by `src/modules/chat-gutters` (`ChatGutterLayout`), which reads the selected roadmap's
 * standing for the Roadmap widget's count and its amber.
 *
 * `roadmapSelected` is a server-backed preference, so the choice follows the operator from desktop to
 * phone, and it is written WHOLE: the last device to choose wins, which is what "the roadmap on
 * screen" means. A stored name the picture does not hold — the roadmap was removed, or the preference
 * was never set — reads as the FIRST roadmap, so the screen always shows one while any exists. That
 * fallback is a reading and not a write: the preference stays as it was, and a roadmap re-added
 * under the same name is on screen again.
 *
 * `selected` IS `null` UNTIL THE PREFERENCES HAVE SETTLED (`hasHydratedUserPreferences`). On a cold
 * mirror — every fresh sign-in, since sign-out clears it — `roadmapSelected` reads its default while the
 * server's copy is still on its way, and answering the FIRST roadmap then would show the wrong one for a
 * moment and hand a destructive reader (a celebration stamping what it played) the wrong roadmap. The
 * hook already listens to the preference store, so the hydrate that settles it re-renders this too.
 * `select` is a press on a drawn picker, so it cannot arrive before there is a `selected` to draw.
 */
export function useRoadmap(): RoadmapView {
  const topic = useLiveTopic<RoadmapPicture>(ROADMAP_ALL_TOPIC);
  const picture = topic?.payload ?? null;

  // The preference store is an external store, read through its one subscription (the idiom of
  // `usePlainModePreference`): the name is the user's, so it follows a hydrate and another tab's write.
  const storedName = useSyncExternalStore(
    subscribeToUserPreferences,
    () => readUserPreference<string | null>('roadmapSelected', null),
  );

  // Whether the stored name above is the user's own or a cold-mirror placeholder. It is a second
  // subscription rather than part of the first snapshot because a hydrate that finds the name still
  // unset leaves `storedName` as it was, and only this one tells the hook that "unset" is now the answer.
  const settled = useSyncExternalStore(subscribeToUserPreferences, hasHydratedUserPreferences);

  const roadmaps = picture?.roadmaps ?? NO_ROADMAPS;
  const selected = useMemo(
    () => (settled ? roadmaps.find((roadmap) => roadmap.name === storedName) ?? roadmaps[0] ?? null : null),
    [roadmaps, settled, storedName],
  );

  const select = useCallback((name: string) => writeUserPreference('roadmapSelected', name), []);

  return useMemo(() => ({ picture, roadmaps, selected, select }), [picture, roadmaps, selected, select]);
}
