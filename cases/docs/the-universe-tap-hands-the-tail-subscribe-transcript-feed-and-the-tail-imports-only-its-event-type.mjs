// protects: server/modules/universe/universe-transcript.tap.ts, server/modules/universe/universe-transcript-tail.ts
// writes: none
// The tap hands the tail the server's feed door (subscribeTranscriptFeed from the providers barrel) as its subscribe, and
// the tail takes the feed's event type with an import type only: it never touches the server's feed instance itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCase, held, broken } from "../lib/case.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TAP = path.join(REPO, "server/modules/universe/universe-transcript.tap.ts");
const TAIL = path.join(REPO, "server/modules/universe/universe-transcript-tail.ts");

runCase(async () => {
  const tap = fs.readFileSync(TAP, "utf8");
  const tail = fs.readFileSync(TAIL, "utf8");
  const wrong = [];
  const tapImports = tap.match(/^import[\s\S]*?from\s*'[^']+';/gm) ?? [];
  if (!tapImports.some((s) => /^import\s*\{[^}]*\bsubscribeTranscriptFeed\b[^}]*\}\s*from\s*'@\/modules\/providers\/index\.js'/.test(s))) {
    wrong.push("the tap does not import subscribeTranscriptFeed from '@/modules/providers/index.js'");
  }
  const call = tap.match(/createTranscriptTail\(\{([\s\S]*?)\}\);/);
  if (!call) wrong.push("the tap has no createTranscriptTail({ ... }) call");
  else if (!/\bsubscribe:\s*subscribeTranscriptFeed\b/.test(call[1])) wrong.push("the tap's createTranscriptTail call does not pass subscribe: subscribeTranscriptFeed");
  const tailImports = tail.match(/^import[\s\S]*?from\s*'[^']+';/gm) ?? [];
  const values = tailImports.filter((s) => /from\s*'[^']*(modules\/providers|transcript-feed|sessions-watcher)[^']*'/.test(s) && !/^import\s+type\b/.test(s));
  if (values.length) wrong.push("the tail imports a value from the feed's side: " + values.join(" | ").replace(/\s+/g, " "));
  if (!tailImports.some((s) => /^import\s+type\s*\{[^}]*\bTranscriptFileEvent\b[^}]*\}\s*from\s*'@\/modules\/providers\/index\.js'/.test(s))) {
    wrong.push("the tail does not take TranscriptFileEvent with import type from '@/modules/providers/index.js'");
  }
  if (wrong.length) return broken(wrong.join("; ").slice(0, 380));
  return held("the tap imports subscribeTranscriptFeed from the providers barrel and passes it as subscribe; the tail imports TranscriptFileEvent as a type only");
});
