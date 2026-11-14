import net from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';

/** Where a request came from and what it was opened under, in the form a log line carries. */
export type RequestSource = {
  /** The client's address: the first hop of `X-Forwarded-For` when the front stamped an IP there, else the socket's own. */
  from: string;
  /** The name the page was opened under: `X-Forwarded-Host`, else `Host`. A name this server cannot print safely reads `unknown`. */
  host: string;
};

const SAFE_HOST = /^[\w.:[\]-]{1,100}$/;

/** The first hop of a header that may repeat or list, or null when it is absent or blank. */
function firstHop(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' ? value.split(',')[0].trim() || null : null;
}

/**
 * Names the client of a request for a journal line. Behind the operator's HTTPS front (`tailscale serve`, which writes both headers
 * itself and REPLACES any copy a client sent) `from` is the device's tailnet address, which is what tells his desktop from his phone;
 * the socket's own address is this box then, and says nothing. With no front the headers are whatever the client sent, so the
 * answer is for reading a log, never for deciding anything.
 *
 * Used by the boot-report module (the line it writes per report) and the websocket module (the line it writes when a socket
 * authenticates), so the two journals name a client the same way and one `grep` joins a failed page to the sockets of the same device.
 */
export function requestSourceOf(headers: IncomingHttpHeaders, socketAddress: string | null | undefined): RequestSource {
  const stamped = firstHop(headers['x-forwarded-for']);
  const host = firstHop(headers['x-forwarded-host']) ?? firstHop(headers.host);
  return {
    from: stamped !== null && net.isIP(stamped) !== 0 ? stamped : (socketAddress ?? 'unknown'),
    host: host !== null && SAFE_HOST.test(host) ? host : 'unknown',
  };
}
