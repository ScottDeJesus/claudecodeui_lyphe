import fs from 'node:fs';
import path from 'node:path';

import { isText } from '@/shared/document-fields.js';
import { dispatchSoulsStateDir } from '@/shared/utils.js';

/**
 * A RUN'S OWN DOCUMENTS, READ BEHIND A FENCE. The paths a chain's record and report name — each stage's `result.md`, a reviewer's
 * findings file — come out of JSON the launcher wrote, and a path out of JSON is never joined onto a read unchecked. This file is
 * the one door through which the companion's run reads open one of them.
 *
 * Consumer: the companion's `eyes/run-scopes.ts` (through this module's barrel), for the `result`, `failure` and `findings` scopes.
 */

/** The largest document (a result or a review file) `readRunDocument` reads: a builder's report is kilobytes; a file past this is not one. */
const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;

/** The pipeline-reviews root beside the launcher's state root: where a reviewer's findings file lives (`<slug>/<slug>-athena-1.md`). */
function reviewsRootBeside(soulsRoot: string): string {
  return path.join(path.dirname(soulsRoot), 'pipeline-reviews');
}

/** Whether `file` lies inside `root` once both are resolved through links, so a link out of the root fails. */
function isInside(root: string, file: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(file);
    return realFile.startsWith(realRoot + path.sep);
  } catch {
    return false;
  }
}

/**
 * The text of a run's own document — a stage's `result.md` or a reviewer's findings file, the paths a chain's record and
 * report name — or `null`. The path comes out of a JSON record, so it is read only when it is a regular `.md` file of at most
 * 2 MB INSIDE the launcher's launch root or the pipeline-reviews root beside it (both move with
 * `DISPATCH_SOULS_STATE_DIR`); anything else, a link out of those roots included, is `null`.
 * Consumed by the companion's `eyes/run-scopes.ts`, which hands what it returns to a dactyl (or to his panel).
 */
export function readRunDocument(file: string): string | null {
  if (!isText(file) || !path.isAbsolute(file) || path.extname(file) !== '.md') return null;
  const soulsRoot = dispatchSoulsStateDir();
  if (!isInside(soulsRoot, file) && !isInside(reviewsRootBeside(soulsRoot), file)) return null;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > DOCUMENT_MAX_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
