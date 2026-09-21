import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expandHome } from '@/shared/utils.js';

/**
 * The Claude ACCOUNT SWITCHER's slot store: one directory per captured login, and the verbs that
 * move a login between a slot and the live pair the `claude` binary reads.
 *
 * THE PAIR. A login is two files — `~/.claude/.credentials.json` (the credential bytes) and
 * `~/.claude.json` (the identity under `oauthAccount`, plus ~46 KB of unrelated CLI state) — and a
 * switch must move BOTH, or the box ends up with one account's credentials under another's identity.
 * A slot is `<root>/<slug>/{credentials.json,claude.json}`: the same pair, snapshotted.
 *
 * THREE RULES, all of them load-bearing:
 *
 *   1. CAPTURE-FIRST. `captureLive` files the live pair under the slug of the live file's OWN
 *      identity, never one a caller assumed, and `install` calls it BEFORE copying the target slot
 *      over the live files. So the login being replaced is saved before anything is overwritten, and
 *      a live pair clobbered by a still-running session self-heals into the right slot next switch.
 *      The order IS the rule: install's refusal happens before a single byte moves. Honest residual:
 *      that self-heal files the CLOBBERED pair over the slot's
 *      good one, and `drift` cannot see it, because the identities match. Recovery is a fresh
 *      `/login` — no cure fits inside rule 3, since the store cannot tell whose tokens it holds.
 *   2. DRIFT IS A FULL-EMAIL COMPARE — the live identity against the ACTIVE SLOT's stored identity,
 *      never one re-derived from a slug, because two accounts can share an email local-part and a
 *      slug carries a disambiguating suffix. Unprovable drift reads FALSE: an alarm that fires on
 *      every poll is worse than a missed one.
 *   3. THE CREDENTIAL BYTES ARE COPIES, NEVER READINGS. The pair is copied file-to-file and never
 *      parsed, logged or returned. The ONE value ever read out of a credentials file is
 *      `claudeAiOauth.expiresAt` — a freshness clock, not a secret — and every projection below
 *      carries labels, booleans and that timestamp only.
 *
 * EVERY WRITE IS TEMP-FILE-THEN-RENAME, and every verb runs to completion before it returns: the
 * server is one JS thread, so the staging order — not a lock — is what keeps a pair whole. Slot
 * directories are 0700, every file 0600, and the operator's home is never re-permissioned
 * (`prepareDirectory`). `CLOUDCLI_ACCOUNTS_ROOT` redirects slots and active-slug file together, read
 * at CALL time rather than at module load, so a probe gets the scratch root it set; the live pair is
 * deliberately NOT redirectable, since a variable that moved it could swap a login nobody named.
 *
 * Consumers: the switcher's routes — the picture and slot list they serve, and the switch and capture
 * writes. Nothing outside this module reads a slot.
 */

/** One captured slot as the switcher draws it. `expiresAt` is epoch MILLISECONDS and `null` when
 *  unread — never 0, which a row would render as an expired login. */
export type AccountSlot = {
  slug: string;
  label: string;
  expiresAt: number | null;
  isActive: boolean;
};

/**
 * The whole account picture in one object: every slot, the live login, and the two facts the panel
 * reads (`drift`, and whether anything is readable at all). It is the `reachable: true` branch of the
 * accounts body minus `reachable` — the route's own envelope — and minus `liveSessions`, a fact about
 * running sessions that a standalone store cannot know.
 *
 * `null` is the other answer and means exactly one thing: nothing captured AND no readable live
 * login. A caller draws the unreadable picture from it, because an empty switcher reads as "you have
 * no accounts", which is a different and false claim.
 */
export type AccountStateSummary = {
  active: string | null;
  activeLabel: string | null;
  slots: AccountSlot[];
  liveLabel: string | null;
  liveExpiresAt: number | null;
  drift: boolean;
};

/** A door refusal — an unknown slot, a live login that cannot be read, a name that is not a slot.
 *  The routes answer 422 with these words. Nothing on these paths is a 500. */
export class AccountRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountRefusal';
  }
}

const SLOT_CREDENTIALS_NAME = 'credentials.json';
const SLOT_CLAUDE_NAME = 'claude.json';
const ACTIVE_SLUG_NAME = 'active';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

const SLUG_MAX_LENGTH = 64;
/** A slot name is an ALLOWLIST, never a denylist: no separator, no dot-only name, no escape. */
const SLUG_SAFE = /^[a-z0-9._-]{1,64}$/;
const SLUG_UNSAFE = /[^a-z0-9._-]+/g;
const SLUG_EDGES = /^[-._]+|[-._]+$/g;

/** Identity reads cached against a file's stat key: the live claude.json is read on every poll, and
 *  46 KB a tick is work with nothing to show for it. */
const emailCache = new Map<string, { statKey: string; email: string | null }>();

/** Where the slots live — `CLOUDCLI_ACCOUNTS_ROOT` when set, read on every CALL rather than at module
 *  load, so the store a probe redirects is the store it gets. */
export function accountsRoot(): string {
  return expandHome(
    process.env.CLOUDCLI_ACCOUNTS_ROOT || path.join(os.homedir(), '.cloudcli', 'accounts'),
  );
}

/** The credential file the live login lives in. */
function liveCredentialsPath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

/** The live identity file — the identity, plus the CLI's unrelated state beside it. */
function liveClaudeJsonPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

/** One slot's directory. Callers pass a name this module minted or already validated. */
function slotDir(slug: string): string {
  return path.join(accountsRoot(), slug);
}

/** A plain object, or false for anything else — arrays included. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A fault's CODE — `EACCES`, `EISDIR`, `ENOSPC` — which is the whole of what a refusal may say about
 *  a failed copy, and the one word a reader can act on. Never the message, which a filesystem error
 *  fills with a path, and never anything read from the files. Node gives every filesystem error the
 *  plain name `Error`, so the errno is the only identifying part of one; a fault carrying no code
 *  falls back to the name. */
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && code ? code : error.name;
}

/** May this name be a slot directory? Asked of every slug arriving from OUTSIDE — a switch body, a
 *  hand-edited active-slug file — and of nothing else, since a minted slug is safe by construction.
 *  The dot names are refused so a slug can never mean the accounts root itself. */
function isPlainSlugName(slug: string): boolean {
  return SLUG_SAFE.test(slug) && slug !== '.' && slug !== '..';
}

/** The local-part of an email as a filesystem-safe slug: lowercased, restricted to the allowlist (a
 *  run of anything else collapses to one dash), stripped of edge dots/dashes/underscores, capped at
 *  64. A local-part that empties out falls back to `account`, so a slot is always nameable. */
function slugify(email: string): string {
  const localPart = email.split('@', 1)[0].trim().toLowerCase();
  const slug = localPart.replace(SLUG_UNSAFE, '-').replace(SLUG_EDGES, '');
  return slug.slice(0, SLUG_MAX_LENGTH) || 'account';
}

/** Whether a path exists at all, of any type — the question a slug probe asks. */
function exists(target: string): boolean {
  try {
    fs.statSync(target);
    return true;
  } catch {
    return false;
  }
}

/** A file (a symlink to one included), in a boolean. */
function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

/** A directory (a symlink to one included), in a boolean. */
function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** `${mtimeNs}:${size}:${ino}`, or `null` when the file cannot be stat'd. NOT mtime alone: its
 *  granularity is coarse enough that a write landing in the same tick as a prior one would leave a
 *  cached label standing. A rename mints a new inode, so that key alone busts the cache on every
 *  write this store makes. */
function statKey(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    return `${stat.mtimeNs}:${stat.size}:${stat.ino}`;
  } catch {
    return null;
  }
}

/** `oauthAccount.emailAddress` from a claude.json — the live one or a slot's — cached against the
 *  file's stat key. An absent, unreadable or malformed file degrades to `null`, so an unknown
 *  identity is a blank label rather than a raise on a read path. */
function readEmailAt(claudeJsonPath: string): string | null {
  const key = statKey(claudeJsonPath);
  if (key === null) return null;
  const cached = emailCache.get(claudeJsonPath);
  if (cached && cached.statKey === key) return cached.email;
  let email: string | null = null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
    const oauthAccount = isRecord(parsed) ? parsed.oauthAccount : null;
    const address = isRecord(oauthAccount) ? oauthAccount.emailAddress : null;
    if (typeof address === 'string' && address.trim()) email = address.trim();
  } catch {
    // Unreadable, absent, or not JSON: `null` stands, which is "identity unknown".
  }
  emailCache.set(claudeJsonPath, { statKey: key, email });
  return email;
}

/** `claudeAiOauth.expiresAt` (epoch ms) from a credentials file — the ONE value this store reads out
 *  of one, and a freshness clock rather than a secret. A non-numeric, absent or unreadable value
 *  degrades to `null`. A JSON `true` is a number to `typeof`, so it is excluded explicitly. */
function readExpiresAt(credentialsPath: string): number | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const oauth = isRecord(parsed) ? parsed.claudeAiOauth : null;
    const expiresAt = isRecord(oauth) ? oauth.expiresAt : null;
    return typeof expiresAt === 'number' && Number.isInteger(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

/** Is this directory the accounts root or under it? Nothing outside it is ever re-permissioned. */
function isWithinAccountsRoot(directory: string): boolean {
  try {
    const root = fs.realpathSync(accountsRoot());
    const target = fs.realpathSync(directory);
    return target === root || target.startsWith(`${root}${path.sep}`);
  } catch {
    return false;
  }
}

/**
 * mkdir a destination's directory, and — for anything under the accounts root — chmod BOTH it and
 * the root itself to 0700. `mkdir` honours the process umask, so a slot tree born 0755 would expose
 * the login to every account on the box. The live files' own directories are outside that rule: this
 * store never re-permissions the operator's home.
 */
function prepareDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
  if (!isWithinAccountsRoot(directory)) return;
  for (const target of [accountsRoot(), directory]) {
    try {
      fs.chmodSync(target, DIR_MODE);
    } catch {
      // A directory that could not be re-chmoded is not a reason to abort: the files written inside
      // it are 0600 either way, so no credential byte is readable by anyone else.
    }
  }
}

/** One copy: `from` → `to`. */
type FilePair = readonly [from: string, to: string];

/** Sweep staged temps that were never committed. A temp holds a WHOLE copy of a credential file, so
 *  a leftover is a live login sitting in a directory nobody looks in. Best effort by design: a temp
 *  may never have been created, and one already consumed by its own rename is simply gone. */
function sweepTemps(temps: readonly string[]): void {
  for (const tmp of temps) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Nothing here is worth failing a refusal over — the destination is the caller's to explain.
    }
  }
}

/**
 * Copy every pair, staging first and renaming second: a failure while staging aborts BEFORE any
 * rename, so the destinations are never left as a mixed pair. A temp name is unique per process and
 * attempt, carries 0600 from the moment it exists, and is swept on EVERY failing path — the commit
 * loop included, which is why it is guarded rather than left to run open.
 *
 * Honest residual: a CRASH between the two renames leaves file one new and file two old, and a fault
 * IN the commit loop can do the same. That is inherent to a journal-less two-file swap, and it
 * self-heals on the next switch, whose capture-first snapshot files the mixed pair under the identity
 * the live file actually carries.
 */
function writePair(pairs: readonly FilePair[]): void {
  const staged: Array<{ tmp: string; to: string }> = [];
  const stagedTemps = (): string[] => staged.map(({ tmp }) => tmp);
  try {
    for (const [from, to] of pairs) {
      const directory = path.dirname(to);
      prepareDirectory(directory);
      const tmp = path.join(
        directory,
        `.${path.basename(to)}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`,
      );
      staged.push({ tmp, to });
      fs.copyFileSync(from, tmp);
      fs.chmodSync(tmp, FILE_MODE);
    }
  } catch (error) {
    sweepTemps(stagedTemps());
    throw error;
  }
  for (const { tmp, to } of staged) {
    try {
      fs.renameSync(tmp, to);
    } catch (error) {
      // This rename failed and every rename after it never ran, so each of those temps is still on
      // disk holding a whole credential copy. An EARLIER temp was consumed by its own rename and is
      // gone, so sweeping the whole list is exact — and no destination is ever unlinked here.
      sweepTemps(stagedTemps());
      throw error;
    }
  }
}

/**
 * The slug the LIVE login is captured into, COLLISION-SAFE. The base slug is the sanitized
 * local-part, but two accounts can share one — the second capture would silently overwrite the
 * first's credential pair. So a candidate is used only when its slot is empty, or provably holds
 * THIS full email: re-capturing the same account stays idempotent, which is the token-refresh path.
 * A slot holding a different email — or one whose identity cannot be read, so sameness cannot be
 * proven — is never overwritten; the slug escalates to base-plus-domain, then to base-plus-a-
 * content-hash of the full email, which is deterministic. The base candidate is tried first, so an
 * existing slot keeps the name it already has.
 */
function resolveSlotSlug(email: string): string {
  const base = slugify(email);
  const normalized = email.trim().toLowerCase();
  const domain = normalized.includes('@') ? normalized.slice(normalized.indexOf('@') + 1) : '';
  const domainSlug = domain.replace(SLUG_UNSAFE, '-').replace(SLUG_EDGES, '');
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 6);

  const candidates = [base];
  // The domain tier is offered only when it FITS: a domain over 56 characters would leave no room
  // for even one base character inside the 64 cap, and the slice would mint a leading-dash slug.
  if (domainSlug && domainSlug.length <= 56) {
    candidates.push(
      `${base.slice(0, 57 - domainSlug.length)}-${domainSlug}`.slice(0, SLUG_MAX_LENGTH),
    );
  }
  candidates.push(`${base.slice(0, 57)}-${digest}`);

  for (const candidate of candidates) {
    // `active` names the file that records the live slot, not a slot: a directory of that name would
    // BE that file's path. The hash candidate below always differs, so skipping this one is safe.
    if (candidate === ACTIVE_SLUG_NAME) continue;
    const slotClaudeJson = path.join(slotDir(candidate), SLOT_CLAUDE_NAME);
    if (!exists(slotClaudeJson)) return candidate;
    const stored = readEmailAt(slotClaudeJson);
    if (stored !== null && stored.toLowerCase() === normalized) return candidate;
  }
  // Unreachable in practice — the hash candidate is content-addressed by the whole email — so this
  // refuses rather than overwriting a slot that provably belongs to somebody else.
  throw new AccountRefusal(`can't allocate a slot for this account (every name for ${base} is taken)`);
}

/** The live login's email: the label every row and every drift check reads. `null` when the live
 *  claude.json cannot be read, which is the calm "identity unknown" and never an error. */
export function identity(): string | null {
  return readEmailAt(liveClaudeJsonPath());
}

/** The slug recorded as active, or `null` when nothing is recorded — no file yet, or an unreadable
 *  one. The recorded name is validated on the way out, so a hand-edited file cannot aim the store at
 *  a path outside the accounts root. */
export function activeSlug(): string | null {
  try {
    const recorded = fs.readFileSync(path.join(accountsRoot(), ACTIVE_SLUG_NAME), 'utf8').trim();
    return isPlainSlugName(recorded) ? recorded : null;
  } catch {
    return null;
  }
}

/** Record which slot is now the live login — one line in `<root>/active`, staged and renamed, so a
 *  reader never sees half a name. The CALLER does this after a successful switch or capture: the
 *  write verbs move files and never assume which account is meant to be active. A name that is not a
 *  slot name is refused, because this file is read back and used as a path. */
export function setActiveSlug(slug: string): void {
  if (!isPlainSlugName(slug)) {
    throw new AccountRefusal(`refusing to record ${slug} as the active account — not a slot name`);
  }
  const root = accountsRoot();
  prepareDirectory(root);
  const tmp = path.join(
    root,
    `.${ACTIVE_SLUG_NAME}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`,
  );
  try {
    fs.writeFileSync(tmp, `${slug}\n`);
    fs.chmodSync(tmp, FILE_MODE);
    fs.renameSync(tmp, path.join(root, ACTIVE_SLUG_NAME));
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // Best effort — the temp may never have been created.
    }
    throw new AccountRefusal(`couldn't record the active account (${errorCode(error)})`);
  }
}

/** Every captured slot, sorted by slug. A slot counts only when BOTH pair files are present: a
 *  half-written one (an aborted capture) is not switchable and stays invisible until it is whole. A
 *  missing root is an empty switcher, not a fault. */
export function listSlots(): AccountSlot[] {
  const root = accountsRoot();
  const active = activeSlug();
  let names: string[];
  try {
    names = fs.readdirSync(root).sort();
  } catch {
    return [];
  }
  const slots: AccountSlot[] = [];
  for (const name of names) {
    const directory = path.join(root, name);
    if (!isDirectory(directory)) continue;
    const credentials = path.join(directory, SLOT_CREDENTIALS_NAME);
    const claudeJson = path.join(directory, SLOT_CLAUDE_NAME);
    if (!isFile(credentials) || !isFile(claudeJson)) continue;
    slots.push({
      slug: name,
      label: readEmailAt(claudeJson) ?? name,
      expiresAt: readExpiresAt(credentials),
      isActive: name === active,
    });
  }
  return slots;
}

/** True iff the ACTIVE SLOT's stored identity differs from the live file's — the indicator that a
 *  running session has clobbered the live pair. No active slug, an unknown live identity or an
 *  unreadable active slot all read FALSE: drift that cannot be PROVEN is not reported. */
export function drift(active: string | null): boolean {
  if (!active) return false;
  const live = identity();
  if (!live) return false;
  const stored = readEmailAt(path.join(slotDir(active), SLOT_CLAUDE_NAME));
  if (!stored) return false;
  return stored.toLowerCase() !== live.toLowerCase();
}

/** The account picture in one read, for the switcher's panel and the chip above it. `null` when
 *  there is nothing to show — no slots and no readable live login. Every step degrades rather than
 *  raising, because this is the read a poll rides. */
export function stateSummary(active: string | null): AccountStateSummary | null {
  const slots = listSlots();
  const liveLabel = identity();
  if (slots.length === 0 && liveLabel === null) return null;
  const activeLabel = slots.find((slot) => slot.slug === active)?.label ?? active;
  return {
    active,
    activeLabel,
    slots,
    liveLabel,
    liveExpiresAt: readExpiresAt(liveCredentialsPath()),
    drift: drift(active),
  };
}

/** Snapshot the LIVE pair into the slot its own identity resolves to, and return that slug. The slot
 *  is chosen by the live file's identity and never by what the caller believes is active, so a pair
 *  clobbered by a running session lands in the right place. Refuses when the live identity or the
 *  live credential file cannot be read — and the refusal arrives before anything is written. */
export function captureLive(): string {
  const email = identity();
  if (!email) {
    throw new AccountRefusal('no live Claude identity to capture (the live login is unreadable)');
  }
  if (!isFile(liveCredentialsPath())) {
    throw new AccountRefusal('the live credentials file is missing — nothing to capture');
  }
  const slug = resolveSlotSlug(email);
  const directory = slotDir(slug);
  try {
    writePair([
      [liveCredentialsPath(), path.join(directory, SLOT_CREDENTIALS_NAME)],
      [liveClaudeJsonPath(), path.join(directory, SLOT_CLAUDE_NAME)],
    ]);
  } catch (error) {
    // A live pair that passed the file check but cannot be READ — permissions, a full disk — is a
    // clean refusal: the type name of the fault, with no path and no credential byte beside it.
    throw new AccountRefusal(
      `couldn't snapshot the live login pair (${errorCode(error)}) — check file permissions`,
    );
  }
  return slug;
}

/**
 * Switch the box to `slug`: snapshot the outgoing login first, then copy the target slot over the
 * live pair. The order is the safety: the capture cannot be skipped, and a live pair that cannot be
 * identified or read refuses the switch instead of overwriting tokens that were never saved.
 *
 * `captured` is the slug the outgoing login was filed under — today it is a slug on every path that
 * returns, since a capture that cannot run refuses first, and the type says what the body means
 * rather than what one implementation happens to do. A MISSING live credential file also refuses,
 * so this cannot restore a wiped login: recovery there is a fresh `claude /login` and a capture.
 *
 * Recording which slot is now live is the CALLER's act (`setActiveSlug`), after this returns: the
 * switch moves files, and a caller restoring a pair has no business moving that mark.
 */
export function install(slug: string): { installed: string; captured: string | null } {
  const known = listSlots().some((slot) => slot.slug === slug);
  if (!known) throw new AccountRefusal(`unknown account slot ${slug}`);

  const captured = captureLive();
  const directory = slotDir(slug);
  try {
    writePair([
      [path.join(directory, SLOT_CREDENTIALS_NAME), liveCredentialsPath()],
      [path.join(directory, SLOT_CLAUDE_NAME), liveClaudeJsonPath()],
    ]);
  } catch (error) {
    // The pre-capture already landed, so no login is lost. A STAGING fault leaves the live pair
    // untouched — but a fault in the commit loop can tear it, the same journal-less residual
    // `writePair` documents — so this claims nothing about the live files beyond that, and the
    // message names neither end of the copy as the culprit.
    throw new AccountRefusal(
      `couldn't install account ${slug} (${errorCode(error)}) — check file permissions`,
    );
  }
  return { installed: slug, captured };
}
