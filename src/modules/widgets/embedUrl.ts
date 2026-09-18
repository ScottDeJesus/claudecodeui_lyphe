/**
 * The one correction made to an embedded address, and why it is a correction rather than a warning.
 *
 * AN `src` IS RESOLVED BY THE READER'S BROWSER, NOT BY THE BOX. That is the whole of it. A URL in a
 * reply is written by a model running on this host, where `http://127.0.0.1:8005` is ArchPulse; the
 * same string in an iframe on a phone over Tailscale is the PHONE'S own port 8005, which is nothing
 * at all, and the frame comes up empty with no error anyone can read (a cross-origin frame tells the
 * embedder nothing — see `EmbedUrlFrame`). The operator reads this app over Tailscale far more often
 * than at the machine, so a loopback address is not an edge case; it is the default way to get this
 * wrong, and it fails silently in exactly the mode the rest of that file is written around.
 *
 * SO THE HOST IS REPLACED WITH THE ONE THAT REACHED THIS PAGE. Whatever name the reader used to open
 * CloudCLI — an address, a machine name, a VPN DNS name — is by construction a
 * name that reaches this box, and every service worth embedding here runs on the same box. The port,
 * the path, the query and the fragment are untouched: only the host moves. This is the same trick
 * `resolveDocSpaceOrigin` plays for the DocSpace embed, and for the same stated reason, which is why
 * it is spelled as a rule here rather than left to the docs to ask for politely.
 *
 * THE ONE EXCEPTION: a reader who IS on loopback. If the page itself was opened on `localhost` or
 * `127.0.0.1`, the reader is at the machine, the address already means what it says, and rewriting
 * it would be a no-op at best and a lie at worst. Nothing is touched then.
 *
 * WHAT IS NOT DONE HERE. A non-loopback host is never second-guessed: an embed naming another server
 * on the network is exactly what this fence is for, and this function has no business moving it. An
 * unparseable address is returned untouched too — `classifyWidgetBody` has already refused anything
 * that does not parse, so reaching that branch means the caller skipped the classifier, and the
 * honest answer is to hand back what was given rather than to invent one.
 */

/** The hosts that mean "the machine this page is open on" — the whole set, in the spellings a URL can carry. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

/** True when this address names the reader's own machine rather than a host on the network. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * The address the frame should actually load.
 *
 * Returns the input unchanged in every case but one: a loopback host, read from a page that is not
 * itself on loopback, is moved onto the page's own hostname. Never throws — the input is model
 * output, and an address this cannot reason about is an address it must not alter.
 */
export function resolveEmbedUrl(url: string): string {
  if (typeof window === 'undefined') return url;
  try {
    const parsed = new URL(url);
    if (!isLoopbackHost(parsed.hostname)) return url;
    // The reader is at the machine: the address already names what it says it names.
    if (isLoopbackHost(window.location.hostname)) return url;
    // The HOST alone. Not the port — the service being embedded chose that — and not the scheme,
    // which `classifyWidgetBody` has already held to http/https.
    parsed.hostname = window.location.hostname;
    return parsed.toString();
  } catch {
    return url;
  }
}
