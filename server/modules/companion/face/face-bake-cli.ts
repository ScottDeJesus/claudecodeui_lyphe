// FIRST, before any import that reads the environment: it fills `COMPANION_FACES_DIR` and the rest from `.env` exactly as
// the server's own entry does (`server/index.ts`), so this door and the API's bake share one faces root. The bootstrap
// file is no boundary element — the same exemption `schedules-cli.ts` takes for the same import.
// eslint-disable-next-line boundaries/no-unknown
import '../../../load-env.js';

import fs from 'node:fs/promises';
import path from 'node:path';

import { HOUSE_AVATARS, houseAvatar, type HouseAvatar } from './face-avatars.js';
import { bakeFace, FaceBakeRefusal } from './face-bake.js';
import { faceDir, storePhoto } from './face-files.js';
import { recordHouseAvatar, refuseIfHouseKeyTaken } from './face-house-ids.js';
import { FACE_FRAMING } from './face-recipe.js';

/**
 * The face's own CLI: `face-bake-cli.ts --photo <path> [--house <key>]` stores a photo, makes its face and prints a line per frame
 * (`37/115 mood.delighted.a2 2.8 s`, or `cached`), then the face id, its folder and its contact sheet. `--house <key>` makes the
 * face with that house avatar's framing (`face-avatars.ts`: `original`, `office`) and registers the photo as that key, once the
 * face is made; without it the face is made with the house framing and registers nothing. It refuses an unknown key, and a key
 * already recorded under another photo, before the first frame. It is the code path the API runs on an upload, with the
 * one difference that it REFUSES at once when another bake holds the lock, where the API waits.
 *
 * It loads no database and touches no account: whose face this becomes is the server's.
 * Exit 0: a published face. Exit 1: a refusal, its sentence printed. Exit 2: a malformed call.
 */

const USAGE = 'usage: face-bake-cli.ts --photo <path> [--house <key>]';
const USAGE_EXIT = 2;

class UsageError extends Error {}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function readArguments(argv: string[]): { photo: string; house: HouseAvatar | null } {
  let photo: string | null = null;
  let house: HouseAvatar | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--house') {
      const key = argv[index + 1] ?? null;
      if (key === null || key.startsWith('--')) throw new UsageError('--house needs a key');
      house = houseAvatar(key) ?? null;
      if (house === null) throw new UsageError(`\`${key}\` is no house avatar; the house's keys are ${HOUSE_AVATARS.map((avatar) => avatar.key).join(', ')}`);
      index += 1;
    } else if (token === '--photo') {
      photo = argv[index + 1] ?? null;
      if (photo === null || photo.startsWith('--')) throw new UsageError('--photo needs a path');
      index += 1;
    } else {
      throw new UsageError(`unexpected argument \`${token}\``);
    }
  }
  if (photo === null) throw new UsageError('--photo is required');
  return { photo, house };
}

async function main(): Promise<number> {
  const { photo, house } = readArguments(process.argv.slice(2));

  const stopper = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const) {
    process.once(name, () => stopper.abort(new FaceBakeRefusal('Stopped; ComfyUI is shut down and the frames made so far are kept.')));
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(photo);
  } catch (error) {
    throw new FaceBakeRefusal(`No photo could be read at ${photo}: ${(error as Error).message}`);
  }
  const stored = await storePhoto(bytes);
  say(`photo ${stored.photoId} ${stored.width}x${stored.height}`);
  // A key already recorded under a different photo is known before the first frame: refuse now, not after the bake. The key
  // itself is still recorded only once a face is made, so a refused photo records none.
  if (house) await refuseIfHouseKeyTaken(house.key, stored.photoId);

  let rendered = 0;
  let renderSeconds = 0;
  const result = await bakeFace({
    photoId: stored.photoId,
    framing: house?.framing ?? FACE_FRAMING,
    whenBusy: 'refuse',
    signal: stopper.signal,
    onProgress(done, total, frame, seconds) {
      if (seconds > 0) {
        rendered += 1;
        renderSeconds += seconds;
      }
      say(`${done}/${total} ${frame} ${seconds > 0 ? `${seconds.toFixed(1)} s` : 'cached'}`);
    },
  });

  if (house) await recordHouseAvatar(house.key, stored.photoId);

  const folder = faceDir(result.faceId);
  say(`face ${result.faceId}`);
  say(`folder ${folder}`);
  say(`contact ${path.join(folder, 'contact.webp')}`);
  const perFrame = rendered === 0 ? 'none rendered' : `${(renderSeconds / rendered).toFixed(1)} s per rendered frame`;
  say(`done ${rendered} rendered, the rest cached, in ${result.seconds.toFixed(1)} s total; ${perFrame}${house ? `; registered as house avatar ${house.key}` : ''}`);
  return 0;
}

/** The exit status is set rather than forced, so a piped stdout is not cut before its last line leaves the buffer. */
main().then((code) => {
  process.exitCode = code;
}, (error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`face-bake-cli: ${error.message}\n${USAGE}\n`);
    process.exitCode = USAGE_EXIT;
  } else if (error instanceof FaceBakeRefusal) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(`face-bake-cli: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  }
});
