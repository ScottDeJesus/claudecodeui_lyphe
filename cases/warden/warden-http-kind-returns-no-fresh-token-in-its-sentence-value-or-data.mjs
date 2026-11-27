// protects: warden/src/probe-kinds/http.mjs, warden/src/probe-support.mjs
// writes: none
//
// The fresh token is sent and never returned: center stores value and data, and the url is reported as the
// definition wrote it. Judged on an answer, on a redirect whose Location echoes the token, and on no answer.

import { broken, held, runCase } from "../lib/case.mjs";
import { startListener } from "../lib/http_listener.mjs";

const KIND_FILE = new URL("../../warden/src/probe-kinds/http.mjs", import.meta.url);
const SENT_TOKEN = /\?t=([A-Za-z0-9]+)$/;
const RUNS = [
  { mode: "ok", timeout: 5, value: /^HTTP 200 in \d+ ms$/, dataKeys: "status,took_ms" },
  { mode: "redirect", timeout: 5, value: /^HTTP 302 in \d+ ms$/, dataKeys: "status,took_ms" },
  { mode: "silent", timeout: 1, value: /^No answer within 1 s$/, dataKeys: "error,took_ms" },
];

runCase(async () => {
  const { run } = await import(KIND_FILE.href);
  const seen = [];
  for (const each of RUNS) {
    const listener = await startListener(each.mode);
    try {
      const url = `${listener.origin}/src/main.tsx?t={nonce}`;
      const spec = { key: "case/nonce-echo", kind: "http", url, timeout: each.timeout };
      const result = await run(spec, {});
      const token = (listener.targets[0] ?? "").match(SENT_TOKEN)?.[1];
      if (!token) return broken(`the ${each.mode} listener heard ${listener.lines.join(" | ") || "nothing"}: no fresh token was sent`);
      const returned = JSON.stringify(result);
      if (returned.includes(token)) return broken(`the ${each.mode} run returned its token ${token}: ${returned}`);
      if (!each.value.test(String(result.value))) return broken(`the ${each.mode} run's value is "${result.value}"`);
      const keys = Object.keys(result.data ?? {}).sort().join(",");
      if (keys !== each.dataKeys) return broken(`the ${each.mode} run returned data keys ${keys || "(none)"}, not ${each.dataKeys}`);
      if (spec.url !== url) return broken(`the ${each.mode} run rewrote the definition's url to ${spec.url}`);
      seen.push(`${each.mode} sent t=${token}, returned "${result.value}"`);
    } finally {
      await listener.close();
    }
  }
  return held(`no token in anything returned — ${seen.join("; ")}`);
});
