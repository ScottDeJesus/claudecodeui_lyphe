import type { AppReleaseReading } from '@/shared/types.js';

const GITHUB_API_ORIGIN = 'https://api.github.com';
/** A read that has not answered in this long is a failed read; the lane keeps its last picture. */
const RELEASE_READ_TIMEOUT_MS = 10_000;
/** GitHub's answer for a repository that has published no release yet: a reading, not a failure. */
const NO_RELEASE_STATUS = 404;

/**
 * The newest release of `repo` (`owner/name`), read from GitHub's public REST API.
 *
 * Throws on a failed read (network, a non-404 error status, a body that is not an object): the polled
 * lane reports it once and keeps the last picture, which is the honest answer to "we could not ask".
 */
export async function readLatestRelease(repo: string): Promise<AppReleaseReading> {
  const response = await fetch(`${GITHUB_API_ORIGIN}/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'cloudcli-app-release' },
    signal: AbortSignal.timeout(RELEASE_READ_TIMEOUT_MS),
  });
  if (response.status === NO_RELEASE_STATUS) return { tag: null, release: null };
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for the latest release of ${repo}`);
  return parseRelease(await response.json(), repo);
}

function parseRelease(body: unknown, repo: string): AppReleaseReading {
  if (typeof body !== 'object' || body === null) {
    throw new Error(`GitHub's latest release of ${repo} is not an object`);
  }
  const tag = stringField(body, 'tag_name');
  if (tag === null) return { tag: null, release: null };
  return {
    tag,
    release: {
      title: stringField(body, 'name') ?? tag,
      body: stringField(body, 'body') ?? '',
      htmlUrl: stringField(body, 'html_url') ?? `https://github.com/${repo}/releases/latest`,
      publishedAt: stringField(body, 'published_at') ?? '',
    },
  };
}

function stringField(record: object, key: string): string | null {
  const value: unknown = Reflect.get(record, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}
