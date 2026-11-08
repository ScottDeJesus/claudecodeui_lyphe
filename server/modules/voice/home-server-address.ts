import { isLinkLocalHost, validateBackendBaseUrl } from './voice.service.js';

const ADDRESS_MAX_CHARS = 300;

const ADDRESS_PROBLEM = 'homeServer.address must be an http or https address like https://box.example.ts.net:8095/v1, with no password, query or fragment in it.';
const LINK_LOCAL_PROBLEM = 'homeServer.address must not be a link-local address (169.254.x.x, fe80::/10): clouds keep their instance metadata there.';

/**
 * The home server's address as the account may save it, or the sentence for why not. The address is the OpenAI-compatible
 * base URL the server posts a clip to (`<address>/audio/transcriptions`), so it is the one place an account steers the
 * server's outbound traffic: an `http` or `https` URL only (the same rule the client re-checks at call time, which also
 * refuses the link-local addresses where clouds keep their instance metadata, IPv4 and IPv6 spellings alike, and a refusal
 * for that reason says so), with no password in it (a secret in a setting is read back and logged
 * by anything that reads settings) and no query or fragment (the client appends a path). It comes back normalized: the
 * host lower-cased, the default port dropped, no trailing slash, so the same box saved twice reads the same.
 * Consumed by `voice-settings.ts`, which stores what this returns and answers a problem as a 400 naming `homeServer.address`.
 */
export function checkHomeServerAddress(value: unknown): { address: string } | { problem: string } {
  if (typeof value !== 'string') return { problem: ADDRESS_PROBLEM };
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > ADDRESS_MAX_CHARS) return { problem: ADDRESS_PROBLEM };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { problem: ADDRESS_PROBLEM };
  }
  if (!validateBackendBaseUrl(parsed.href)) return { problem: isLinkLocalHost(parsed.hostname) ? LINK_LOCAL_PROBLEM : ADDRESS_PROBLEM };
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') return { problem: ADDRESS_PROBLEM };

  return { address: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') };
}
