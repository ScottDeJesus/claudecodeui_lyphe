// `http {url}` — one GET, judged by the status it answers and how long the answer took. Metrics:
// `status`, `took_ms`; default pass `status == 200`. A redirect is an answer, not something to
// follow: a health URL that 302s to a login page must not read as healthy because the login page
// returned 200. `node:http` is used instead of `fetch` because fetch carries a hidden 10-second
// connect timeout that would silently undercut any `timeout` above it.
//
// Every `{nonce}` in the url is replaced with one fresh token per run, so a caching server (Vite's
// module cache) has to answer the GET itself. The token is never echoed: nothing returned names the url.

import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

import { deadlineMs, describeNetworkError, elapsedMs, finishProbe, formatSeconds, missingField, unrunnable } from '../probe-support.mjs';

const NONCE_PLACEHOLDER = '{nonce}';
const NONCE_BYTES = 8;

// The url to send: every `{nonce}` filled with the same fresh hex token, any other url untouched.
function withFreshNonce(url) {
  if (typeof url !== 'string' || !url.includes(NONCE_PLACEHOLDER)) return url;
  return url.replaceAll(NONCE_PLACEHOLDER, crypto.randomBytes(NONCE_BYTES).toString('hex'));
}

// One GET, resolving with `{ status }`, `{ timedOut }` or `{ error }`. The body is never read: the
// status line is the measurement, and a large body must not hold the probe past its answer.
function requestOnce(target, timeoutMs) {
  return new Promise((resolve) => {
    let timer;
    const transport = target.protocol === 'https:' ? https : http;
    const finish = (answer) => {
      clearTimeout(timer);
      resolve(answer);
    };

    // agent: false — a fresh connection per probe, so the time includes connecting, as a caller's would.
    const request = transport.get(target, { agent: false, headers: { 'User-Agent': 'cerberus-warden' } }, (response) => {
      finish({ status: response.statusCode });
      response.on('error', () => {});
      response.destroy();
    });
    request.on('error', (error) => finish({ error }));
    timer = setTimeout(() => {
      finish({ timedOut: true });
      request.destroy();
    }, timeoutMs);
  });
}

export async function run(spec, _memory) {
  const missing = missingField(spec, ['url']);
  if (missing) return unrunnable(spec, missing);
  const url = withFreshNonce(spec.url);
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    return unrunnable(spec, "The definition's url can't be read");
  }

  const startedAt = performance.now();
  const answer = await requestOnce(new URL(url), deadlineMs(spec));
  const tookMs = elapsedMs(startedAt);

  if (answer.timedOut) {
    return finishProbe(spec, {
      completed: false,
      sentence: `No answer within ${formatSeconds(spec.timeout)}`,
      data: { error: 'timeout', took_ms: tookMs },
    }, tookMs);
  }
  if (answer.error) {
    const { code, sentence } = describeNetworkError(answer.error);
    return finishProbe(spec, { completed: false, sentence, data: { error: code, took_ms: tookMs } }, tookMs);
  }
  const metrics = { status: answer.status, took_ms: tookMs };
  return finishProbe(spec, { completed: true, sentence: `HTTP ${answer.status} in ${tookMs} ms`, metrics }, tookMs);
}
