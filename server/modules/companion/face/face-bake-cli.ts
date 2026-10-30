// FIRST, before any import that reads the environment: it fills `COMPANION_FACES_DIR` and the rest from `.env` exactly as
// the server's own entry does (`server/index.ts`), so this door and the API's bake share one faces root. The bootstrap
// file is no boundary element — the same exemption `schedules-cli.ts` takes for the same import.
// eslint-disable-next-line boundaries/no-unknown
import '../../../load-env.js';

import fs from 'node:fs/promises';
import path from 'node:path';

import { bakeFace, FaceBakeRefusal } from './face-bake.js';
import { faceDir, recordSeed, refuseIfSeedTaken, storePhoto } from './face-files.js';

/**
 * The face's own CLI: `face-bake-cli.ts --photo <path> [--seed]` stores a photo, makes its face and prints a line per frame
 * (`37/115 mood.delighted.a2 2.8 s`, or `cached`), then the face id, its folder and its contact sheet. `--seed` also
 * registers the photo as the original, once the face is made. It is the code path the API runs on an upload, with the
 * one difference that it REFUSES at once when another bake holds the lock, where the API waits.
 *
 * It loads no database and touches no account: whose face this becomes is the server's.
 * Exit 0: a published face. Exit 1: a refusal, its sentence printed. Exit 2: a malformed call.
 */

const USAGE = 'usage: face-bake-cli.ts --photo <path> [--seed]';
const USAGE_EXIT = 2;

class UsageError extends Error {}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function readArguments(argv: string[]): { photo: string; seed: boolean } {
  let photo: string | null = null;
  let seed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--seed') {
      seed = true;
    } else if (token === '--photo') {
      photo = argv[index + 1] ?? null;
      if (photo === null || photo.startsWith('--')) throw new UsageError('--photo needs a path');
      index += 1;
    } else {
      throw new UsageError(`unexpected argument \`${token}\``);
    }
  }
  if (photo === null) throw new UsageError('--photo is required');
  return { photo, seed };
}

async function main(): Promise<number> {
  const { photo, seed } = readArguments(process.argv.slice(2));

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
  // A different original already registered is known before the first frame: refuse now, not after the bake. The seed
  // itself is still written only once a face is made, so a refused photo leaves none.
  if (seed) await refuseIfSeedTaken(stored.photoId);

  let rendered = 0;
  let renderSeconds = 0;
  const result = await bakeFace({
    photoId: stored.photoId,
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

  if (seed) await recordSeed(stored.photoId);

  const folder = faceDir(result.faceId);
  say(`face ${result.faceId}`);
  say(`folder ${folder}`);
  say(`contact ${path.join(folder, 'contact.webp')}`);
  const perFrame = rendered === 0 ? 'none rendered' : `${(renderSeconds / rendered).toFixed(1)} s per rendered frame`;
  say(`done ${rendered} rendered, the rest cached, in ${result.seconds.toFixed(1)} s total; ${perFrame}${seed ? '; registered as the original' : ''}`);
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
