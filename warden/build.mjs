// `npm run build:warden`: packs the warden into the one tarball `enroll.sh` installs.
//
//   dist-warden/cerberus-warden-<version>.tar.gz   the release: warden/{package.json,enroll.sh,src,systemd} and the four
//                                                  session-host files (`HOST_FILES`) at their repo paths, plus a root package.json
//   dist-warden/cerberus-warden-<version>.tar.gz.sha256   `sha256sum -c` format
//   dist-warden/latest.json   { version, file, sha256, size, builtAt } — the release a node fetches first
//
// Center serves these three from `dist-warden/` (`server/modules/cerberus/warden-files.ts`), so a build
// is live the moment it lands. The tarball is written under a `.partial` name and renamed into place
// only after `tar` has exited 0, and `latest.json` is renamed in last: a build that fails or is killed
// leaves the name a node fetches either untouched or whole, and a node that reads `latest.json` finds
// a tarball that is already whole.
//
// A version that is already built is refused, because a node that holds that version would never fetch
// the changed files (`enroll.sh --refresh` installs only a NEWER version). A plan that changes `warden/`
// bumps the minor version in `warden/package.json` first; this refusal is what makes a forgotten bump
// visible. `--force` rebuilds the same version anyway, for a build nobody has installed; through npm it
// is `npm run build:warden -- --force`, because npm keeps a bare `--force` for itself.
//
// Plain `.mjs`, run by bare `node`, like the rest of `warden/`.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIR = 'dist-warden';
const STAGE_PREFIX = `${OUTPUT_DIR}/stage-`;
/**
 * The session host the warden runs, by the same relative path as in the checkout: `warden/src/sessions.mjs` imports
 * `host-registry.js` as `../../server/...`, and `host-registry.js` names `host.js` beside itself, which imports the
 * other two. Nothing of them is copied or rewritten for the warden; the files that ship are the files the API runs.
 */
const HOST_DIR = 'server/modules/providers/list/claude/session-host';
const HOST_FILES = ['host.js', 'host-conn.js', 'host-journal.js', 'host-registry.js'].map((name) => `${HOST_DIR}/${name}`);
/** What goes into a release, relative to the repo root. Everything else under `warden/` (the manuals, this script) stays home. */
const RELEASE_PATHS = ['warden/package.json', 'warden/enroll.sh', 'warden/src', 'warden/systemd', ...HOST_FILES];
/**
 * The release root's own package.json. The four session-host files are plain `.js` ES modules, and Node reads a
 * `.js` file's module type from the nearest package.json above it — which in the checkout is the app's, and in a
 * release would be none: a Node before 22.7 would then read them as CommonJS and fail on their first `import`.
 */
const RELEASE_ROOT_PACKAGE = `${JSON.stringify({ name: 'cerberus-warden-release', private: true, type: 'module' }, null, 2)}\n`;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Every path below is relative to the repo root, so the stage's prefix check reads the way it is written.
process.chdir(repositoryRoot);

function refuse(sentence) {
  console.log(sentence);
  process.exit(1);
}

function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Copies the release paths into `stage`, each at its repo path. */
function stageRelease(stage) {
  for (const relative of RELEASE_PATHS) {
    const target = path.join(stage, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(relative, target, { recursive: true });
  }
  fs.writeFileSync(path.join(stage, 'package.json'), RELEASE_ROOT_PACKAGE);
}

const force = process.argv.includes('--force');
const { version } = JSON.parse(fs.readFileSync('warden/package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) refuse(`warden/package.json has version "${version}", which is not major.minor.patch.`);

const fileName = `cerberus-warden-${version}.tar.gz`;
const tarball = path.join(OUTPUT_DIR, fileName);
if (fs.existsSync(tarball) && !force) {
  refuse(`Version ${version} is already built — bump the minor version in warden/package.json, or rebuild it with: npm run build:warden -- --force`);
}
// Checked before the stage exists: a refusal exits the process, which would skip the stage's cleanup below.
for (const relative of RELEASE_PATHS) {
  if (!fs.existsSync(relative)) refuse(`The warden cannot be built: ${relative} is missing.`);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const partialTarball = `${tarball}.partial`;
const stage = fs.mkdtempSync(path.join(OUTPUT_DIR, 'stage-'));
try {
  stageRelease(stage);
  execFileSync('tar', ['-czf', partialTarball, '-C', stage, '.']);
  fs.renameSync(partialTarball, tarball);
} finally {
  // The stage is this run's own `mkdtemp`; it is removed only while it still carries that prefix.
  if (stage.startsWith(STAGE_PREFIX)) fs.rmSync(stage, { recursive: true, force: true });
  // After a successful rename there is nothing here; after a failed `tar` this is its half file (one file, never recursive).
  fs.rmSync(partialTarball, { force: true });
}

const sha256 = sha256Of(tarball);
fs.writeFileSync(`${tarball}.sha256`, `${sha256}  ${fileName}\n`);
const latest = { version, file: fileName, sha256, size: fs.statSync(tarball).size, builtAt: new Date().toISOString() };
const latestFile = path.join(OUTPUT_DIR, 'latest.json');
fs.writeFileSync(`${latestFile}.next`, `${JSON.stringify(latest, null, 2)}\n`);
fs.renameSync(`${latestFile}.next`, latestFile);

console.log(`Built ${tarball} (${latest.size} bytes, sha256 ${sha256.slice(0, 12)}…)`);
