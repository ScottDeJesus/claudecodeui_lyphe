/**
 * A 200 answer's body as `T`, or null when the body is not that shape at all.
 *
 * A 200 whose body will not parse was the one answer with no path through the engine:
 * `response.json()` threw, the throw unwound past the caller's own bookkeeping, and a direction that
 * was mid-fetch stayed marked in flight — never asked again, with no banner saying so. The refusal
 * becomes an ordinary answer here, so every caller has one branch to handle and none can leave a
 * flag standing.
 */
export async function readBody<T extends object>(response: Response, key: string): Promise<T | null> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' && key in body ? (body as T) : null;
  } catch {
    return null;
  }
}
