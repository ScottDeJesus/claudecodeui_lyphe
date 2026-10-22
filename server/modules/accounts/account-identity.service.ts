import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The live Claude login's IDENTITY — the email under `oauthAccount.emailAddress` in `~/.claude.json`.
 *
 * ONLY THE EMAIL IS READ. `~/.claude.json` carries the identity plus ~46 KB of unrelated CLI state;
 * `oauthAccount.emailAddress` is the one value this module returns, and no credential file is opened
 * here at all. Nothing here copies, swaps or writes a credential: the account in use is the token
 * switch's (`~/.claude/scripts/claude-account`), and this server only reports who the box is
 * signed in as.
 *
 * Consumers: `accounts/index.ts` re-exports `identity` as `liveAccountEmail`, which the Claude auth
 * provider's "signed in as" line reads when no config directory overrides it.
 */

/** Identity reads cached against a file's stat key: the live claude.json is read on every poll, and
 *  46 KB a tick is work with nothing to show for it. */
const emailCache = new Map<string, { statKey: string; email: string | null }>();

/** The live identity file — the identity, plus the CLI's unrelated state beside it. */
function liveClaudeJsonPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

/** A plain object, or false for anything else — arrays included. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `${mtimeNs}:${size}:${ino}`, or `null` when the file cannot be stat'd. NOT mtime alone: its
 *  granularity is coarse enough that a write landing in the same tick as a prior one would leave a
 *  cached label standing. */
function statKey(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    return `${stat.mtimeNs}:${stat.size}:${stat.ino}`;
  } catch {
    return null;
  }
}

/** `oauthAccount.emailAddress` from a claude.json, cached against the file's stat key. An absent,
 *  unreadable or malformed file degrades to `null`, so an unknown identity is a blank label rather
 *  than a raise on a read path. */
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

/** The live login's email, or `null` when the live claude.json cannot be read — the calm "identity
 *  unknown" and never an error. Used by the Claude auth provider's "signed in as" line. */
export function identity(): string | null {
  return readEmailAt(liveClaudeJsonPath());
}
