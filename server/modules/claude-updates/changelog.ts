/**
 * The two changelogs, and the slice of one that belongs to a given install.
 *
 * npm knows a version; only the changelog knows what is IN it. The registry carries no release notes,
 * so the text is fetched raw from the two repositories' own `CHANGELOG.md` — the CLI's is around
 * 840 KB and is parsed whole, which is why the parse is one forward pass and never a search per
 * version.
 *
 * Three functions, three questions, and no state between them: what the file says (`fetchChangelog`),
 * what its sections are (`parseChangelog`), and which of those a person on a given version has not
 * lived through yet (`notesBetween`).
 */

import type { ClaudeUpdateNote } from '@/shared/claude-update-types.js';
import { isBehindInstalled } from '@/shared/version-order.js';

/**
 * The ceiling on one fetch. A changelog is a convenience beside a version number, so a host that
 * cannot answer it in fifteen seconds must not hold the check open — the notes then come back short
 * with the reason in words, and the versions the check read still stand.
 */
const FETCH_TIMEOUT_MS = 15_000;

/** A section heading and nothing else on the line: `## 2.1.284`. */
const VERSION_HEADING = /^## (\d+\.\d+\.\d+)\s*$/;

/**
 * Any second-level heading closes the body above it, whether or not it names a version — a body runs
 * to the NEXT `## ` heading and no further.
 */
const ANY_SECTION_HEADING = /^## /;

/**
 * One changelog, as sections in file order (which is newest first), or the reason it could not be
 * read.
 *
 * A failure is a value rather than a throw on purpose: notes are an ENRICHMENT of a check whose real
 * answer — the number npm answered — has already been read and must survive whatever the changelog
 * host does.
 */
export async function fetchChangelog(url: string): Promise<{ notes: ClaudeUpdateNote[] } | { error: string }> {
  let markdown: string;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : '';
      return { error: `the changelog answered ${response.status}${statusText}` };
    }
    markdown = await response.text();
  } catch (error) {
    // Words, never a rethrow: this call sits inside a check that has already succeeded at the part
    // that matters, and a check that reports failure because a README host was slow would be lying.
    const detail = error instanceof Error ? error.message : String(error);
    return { error: `the changelog could not be reached: ${detail}` };
  }

  return { notes: parseChangelog(markdown) };
}

/**
 * The `## x.y.z` sections of a changelog, in file order.
 *
 * The heading itself is dropped and everything under it is kept VERBATIM — the markdown is what the
 * preview renders, and rewriting it here would make this file a second renderer. A section's body
 * ends at the next `## ` heading of any kind, so a trailing section that is not a release (a
 * contributor note, say) cannot be folded into the last version's notes. Anything before the first
 * version heading belongs to none of them and is skipped with it.
 */
export function parseChangelog(markdown: string): ClaudeUpdateNote[] {
  const notes: ClaudeUpdateNote[] = [];
  let version: string | null = null;
  let body: string[] = [];

  const closeSection = (): void => {
    if (version !== null) notes.push({ version, body: body.join('\n').trim() });
    version = null;
    body = [];
  };

  for (const line of markdown.split('\n')) {
    const heading = VERSION_HEADING.exec(line);
    if (heading) {
      closeSection();
      version = heading[1];
      continue;
    }
    if (ANY_SECTION_HEADING.test(line)) closeSection();
    else if (version !== null) body.push(line);
  }
  closeSection();

  return notes;
}

/**
 * The sections a person on `installed` has not lived through: `installed < version <= latest`,
 * newest first (the order the file keeps).
 *
 * The window is decided by order and never by equality, which is what lets a release that skipped
 * this host — installed 2.1.281, latest 2.1.284, nothing in between ever installed — read as all
 * three sections. A version that cannot be ordered falls in on the side `isBehindInstalled` chooses,
 * and the notes are never the reason a check fails.
 */
export function notesBetween(notes: ClaudeUpdateNote[], installed: string, latest: string): ClaudeUpdateNote[] {
  return notes.filter(
    (note) => isBehindInstalled(installed, note.version) && !isBehindInstalled(latest, note.version),
  );
}
