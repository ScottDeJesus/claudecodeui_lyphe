// Why a session's request to this box is followed here and not handed to Chromium with the ID added.
// Playwright never routes a redirect's next hop: it replays the first hop's whole header list onto it, whatever
// host the hop is bound for. A request continued with the ID would carry it, and the page's Authorization header
// (which Chromium itself drops when a redirect changes origin), to an outside host an app redirects to. So the
// handler sends each hop itself, judges each hop on its own URL, and answers the page with the final response.
// Measured in real Chromium 2026-11-03: a fulfilled redirect to another origin makes the page's fetch fail
// (net::ERR_FAILED), which is why the handler follows a redirect for the page and does not hand it back.

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_HOPS = 20;

// Headers a hop computes for itself: Node sets the Host and the length, and Playwright asks for the encodings it
// can decode.
const HOP_OWN_HEADERS = new Set(['host', 'content-length', 'accept-encoding']);

// The headers one hop is sent with: the page's, edited by browser-use-budget.ts so that the budget header is
// on a hop to this box and on no other.
export type HopHeaders = (url: string, headers: Record<string, string>) => Record<string, string>;

// Headers that describe a request body; a hop that turns into a GET carries none of them.
const BODY_HEADERS = ['content-type', 'content-encoding', 'content-language', 'content-location'];

// Called by browser-use-budget.ts for every request of a session bound for this box that is not a stream.
// Sends the request with the session's ID, and follows each redirect with the ID on a hop that is on this box
// and without it on a hop that is not (`hopHeaders` decides), dropping Authorization and Referer when the hop
// changes origin, as a browser does, and the first request's Cookie header on every hop. A navigation's redirect
// is handed back to Chromium, because the page's address must change with it; the hop it makes is then not
// routed and carries no ID.
export async function sendRequestWithBudget(route: any, hopHeaders: HopHeaders): Promise<void> {
  const request = route.request();
  let url: string = request.url();
  let method: string = request.method();
  let body: Buffer | null = request.postDataBuffer();
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers() as Record<string, string>)) {
    if (!HOP_OWN_HEADERS.has(name)) {
      headers[name] = value;
    }
  }

  for (let hop = 0; ; hop += 1) {
    let response: any;
    try {
      response = await route.fetch({
        url,
        method,
        headers: hopHeaders(url, headers),
        ...(body ? { postData: body } : {}),
        maxRedirects: 0,
        timeout: 0,
      });
    } catch (error) {
      // The hop may already have reached its server, so Chromium is not offered the request again: it fails.
      // First line only: Playwright's message carries the whole call log, once per request still in flight when
      // a context closes.
      console.warn('[Browser] Budget route could not send', url, error instanceof Error ? error.message.split('\n')[0] : error);
      await route.abort('failed').catch(() => undefined);
      return;
    }

    const status: number = response.status();
    const location: string | undefined = response.headers().location;
    let next: URL | null = null;
    if (REDIRECT_STATUSES.has(status) && location && !request.isNavigationRequest() && hop < MAX_HOPS) {
      try {
        next = new URL(location, url);
      } catch {
        // A Location Node cannot parse is the page's to meet: it is handed back as it came.
      }
    }
    if (!next) {
      await route.fulfill({ response });
      return;
    }

    // The first request's Cookie header is the browser's own for the first URL. Playwright fills a request's
    // Cookie from the context's jar only when it carries none, so this one must go before every hop: the jar then
    // answers for the hop's own URL, set-cookies of the hop before included. Chromium sends a hop none of the
    // first host's.
    delete headers.cookie;
    if (next.origin !== new URL(url).origin) {
      delete headers.authorization;
      // The first request's Referer is the page's whole address, query included. A browser recomputes it for each
      // hop under the page's referrer policy (the origin alone by default, nothing under same-origin or
      // no-referrer); replaying it would hand the next host what the policy keeps from it. Dropping sends no
      // more than any policy would.
      delete headers.referer;
    }
    if (status === 303 ? method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST') {
      method = 'GET';
      // An empty body, not null: route.fetch gives a hop with no body the original request's own.
      body = Buffer.alloc(0);
      for (const name of BODY_HEADERS) {
        delete headers[name];
      }
    }
    url = next.href;
  }
}
