// protects: warden/src/probe-kinds/http.mjs
// writes: none
//
// Every {nonce} in an http probe's url is filled with one fresh letters-and-digits token per run, the same token in
// each place, so a caching server (Vite's module cache) has to answer the GET itself. Two runs, two tokens.

import { broken, held, runCase } from "../lib/case.mjs";
import { startListener } from "../lib/http_listener.mjs";

const KIND_FILE = new URL("../../warden/src/probe-kinds/http.mjs", import.meta.url);
const FILLED = /^\/src\/([A-Za-z0-9]+)\.tsx\?t=([A-Za-z0-9]+)&again=([A-Za-z0-9]+)$/;

runCase(async () => {
  const { run } = await import(KIND_FILE.href);
  const listener = await startListener("ok");
  try {
    const spec = { key: "case/nonce", kind: "http", url: `${listener.origin}/src/{nonce}.tsx?t={nonce}&again={nonce}`, timeout: 5 };
    const results = [await run(spec, {}), await run(spec, {})];
    if (listener.targets.length !== 2) {
      return broken(`two runs reached the listener ${listener.targets.length} times: ${listener.lines.join(" | ") || "nothing"}`);
    }
    const tokens = [];
    for (const target of listener.targets) {
      const match = target.match(FILLED);
      if (!match) return broken(`a run sent ${target}, not one letters-and-digits token in each of the three {nonce} places`);
      if (match[1] !== match[2] || match[2] !== match[3]) return broken(`one run filled its three {nonce} with different tokens: ${target}`);
      tokens.push(match[1]);
    }
    if (tokens[0] === tokens[1]) return broken(`two runs sent the same token ${tokens[0]}: ${listener.lines.join(" | ")}`);
    const notOk = results.find((result) => result.status !== "ok");
    if (notOk) return broken(`a run answered 200 ended ${notOk.status} ("${notOk.value}")`);
    return held(`two runs sent ${listener.lines.join(" and ")}: one token per run in all three places, different between the runs`);
  } finally {
    await listener.close();
  }
});
