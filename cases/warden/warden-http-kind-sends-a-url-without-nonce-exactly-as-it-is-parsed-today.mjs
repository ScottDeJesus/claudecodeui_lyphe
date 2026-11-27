// protects: warden/src/probe-kinds/http.mjs
// writes: none
//
// A url with no {nonce} is sent as it is today: the request target is new URL(url).pathname + search, byte for byte.
// Near misses ride in the query: an escaped placeholder (%7Bnonce%7D), a misspelt one ({nonc}) and an escaped pair.

import { broken, held, runCase } from "../lib/case.mjs";
import { startListener } from "../lib/http_listener.mjs";

const KIND_FILE = new URL("../../warden/src/probe-kinds/http.mjs", import.meta.url);

runCase(async () => {
  const { run } = await import(KIND_FILE.href);
  const listener = await startListener("ok");
  try {
    const url = `${listener.origin}/plain/a-b_c.js?x=1&y=%7Bnonce%7D&w={nonc}&z=%7B%7D`;
    const parsed = new URL(url);
    const expected = parsed.pathname + parsed.search;
    await run({ key: "case/no-nonce", kind: "http", url, timeout: 5 }, {});
    await run({ key: "case/no-nonce", kind: "http", url, timeout: 5 }, {});
    if (listener.targets.length !== 2) return broken(`two runs reached the listener ${listener.targets.length} times`);
    const changed = listener.targets.find((target) => target !== expected);
    if (changed !== undefined) return broken(`a url with no {nonce} was sent as ${changed}, not ${expected}`);
    return held(`both runs sent ${expected}, the url as parsed, unchanged`);
  } finally {
    await listener.close();
  }
});
