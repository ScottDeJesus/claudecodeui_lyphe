import os from 'node:os';
import path from 'node:path';

import { FACE_FRAMING, type FaceFraming } from './face-recipe.js';

/**
 * THE HOUSE'S AVATARS: the looks every account may wear, listed in code, seeded from photo files, made once, and wearable by
 * every account. Each is a portrait and the face the bake makes of it; the first is every account's default. Adding a look is
 * adding an entry here (and a seed photo): the next start stores it, records it in `avatars.json` (`face-house-ids.ts`) and makes
 * its face. Its framing is its own, so tuning one look's crop moves only that look's face: the framing is hashed into the
 * recipe id (`recipeId(framing)`), and `FACE_FRAMING` itself, the framing of Dark hair, is never changed by tuning another look.
 */

/** A look the house offers every account: its key, the label the picker shows, where its photo is seeded from, and the framing its face is made with. */
export type HouseAvatar = { key: string; label: string; seedEnv: string; defaultSeed: string; framing: FaceFraming };

const KAYLEE_IMAGES = path.join(os.homedir(), '.claude', 'state', 'images', 'kaylee');

/**
 * Brown hair's framing, tuned on its own contact sheet. The office picture sits her face near the top with its crown at the
 * picture's top edge (0.77 face sides above the face's centre), and the navy lapels begin 0.59 face sides below it, 0.33 aside:
 * at the house framing's disc (1.75 face sides) the lapel shows at the circle's lower right and the circle's top lies in the
 * pad's band. So the disc is tighter (1.38 face sides, which holds her face and the hair framing it), and the crop with it
 * (`cropFactor` 1.5 reaches 0.75 above the face's centre: the picture's edge is outside it, and the disc's top lies on the preview's
 * edge), keeping the 448 tier. The disc is raised 0.06 so that its top is that edge and its centre is away from the lapel.
 */
const OFFICE_FRAMING: FaceFraming = { cropFactor: 1.5, discSide: 1.38, discRaise: 0.06, frameSizes: [256, 448], pad: 0.5 };

/**
 * The house's avatars in the picker's order. The first is every account's default. A key is never `own` (his photo's), and is never
 * renamed once recorded: `avatars.json` holds each look's photo by its key. Consumed by `face-house-ids.ts` (registration),
 * `face-bake-cli.ts` (`--house`) and `face.service.ts` (the looks the service offers and keeps).
 */
export const HOUSE_AVATARS: readonly HouseAvatar[] = [
  {
    key: 'original',
    label: 'Dark hair',
    seedEnv: 'COMPANION_FACE_SEED',
    defaultSeed: path.join(KAYLEE_IMAGES, 'kaylee-portrait-base.jpg'),
    framing: FACE_FRAMING,
  },
  {
    key: 'office',
    label: 'Brown hair',
    seedEnv: 'COMPANION_FACE_SEED_OFFICE',
    defaultSeed: path.join(KAYLEE_IMAGES, 'kaylee-portrait-office.jpg'),
    framing: OFFICE_FRAMING,
  },
];

/** The key of the look every account wears until it picks another: the house's first. Consumed by `face-house-ids.ts` (a one-photo store's seed becomes this key) and `face.service.ts`. */
export const DEFAULT_AVATAR_KEY: string = HOUSE_AVATARS[0].key;

/** The key of the account's own photo, which no house look may take. Consumed by `face.service.ts`. */
export const OWN_AVATAR_KEY = 'own';

/** The word the picker shows for his own photo: the label of the `own` look, as a house look's is its `label`. Consumed by `face.service.ts`. */
export const OWN_AVATAR_LABEL = 'Your photo';

/** The house avatar named `key`, or undefined. Consumed by `face-bake-cli.ts` and `face.service.ts`. */
export function houseAvatar(key: string): HouseAvatar | undefined {
  return HOUSE_AVATARS.find((avatar) => avatar.key === key);
}

/** The file a house avatar is seeded from: its env variable's path, else its default. Read on each call, so a probe may point it elsewhere. Consumed by `face-house-ids.ts`. */
export function seedFileOf(avatar: HouseAvatar): string {
  return process.env[avatar.seedEnv] || avatar.defaultSeed;
}
