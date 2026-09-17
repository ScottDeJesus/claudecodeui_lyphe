#!/usr/bin/env node
// Mints the short-lived token a universe probe authenticates with: read the one user and the app's
// own JWT secret out of the live auth database, sign the same `{userId, username}` payload
// `auth.middleware.ts:106-115` signs, and print the token and nothing else.
//
//   node scripts/universe-token.mjs
//
// It goes to stdout with no decoration, so `$(node scripts/universe-token.mjs)` drops straight into
// an Authorization header, and nothing is written to disk — a token file is a credential that
// outlives the probe that needed it. Ten minutes is the whole life of this one: long enough for a
// curl or a probe script, short enough that a shell history is worth nothing tomorrow.
//
// The secret is READ, never generated (`auth.middleware.ts:9`): a token signed with a secret of
// this script's own invention is a 401, and a script that quietly created one would look like it
// worked. `JWT_SECRET` in the environment wins over the database row, in that order, because that is
// the order the server reads them in — reversed, the probe and the server would disagree.
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import os from 'node:os';
import path from 'node:path';

/** The app's live database: the one the running server opened, which is the only one whose secret is worth anything. */
const DB_PATH = path.join(os.homedir(), '.cloudcli', 'auth.db');

const die = (message) => {
  console.error(`universe-token: ${message}`);
  process.exit(1);
};

let database;
try {
  database = new Database(DB_PATH, { readonly: true, fileMustExist: true });
} catch (error) {
  die(`cannot open ${DB_PATH} read-only: ${error instanceof Error ? error.message : String(error)}`);
}

let user;
let config;
try {
  // The probe's identity decides the palette the sky is painted in: the theme is a per-user row in
  // `user_preferences`, and the two accounts on this box hold opposite themes. Every gate that reads
  // a screenshot was calibrated on the dark palette, so the identity is pinned — in this order:
  // `UNIVERSE_PROBE_USER` when set (and it must exist: a typo dies here rather than silently
  // minting someone else), else the user whose stored theme is dark (lowest id), else the first
  // user by id, which may render light and says so on stderr — never whichever row an unordered
  // `LIMIT 1` returns today. The secret row's key is matched loosely (`%jwt%`) the way the app's
  // own config repository stores it.
  const wanted = process.env.UNIVERSE_PROBE_USER;
  if (wanted && !database.prepare('SELECT id FROM users WHERE username = ?').get(wanted)) {
    database.close();
    die(`UNIVERSE_PROBE_USER=${wanted} names no user in ${DB_PATH}`);
  }
  user = (wanted && database.prepare('SELECT id, username FROM users WHERE username = ?').get(wanted))
    || database.prepare(`SELECT u.id, u.username FROM users u
         JOIN user_preferences p ON p.user_id = u.id
         WHERE p.preference_key = 'theme' AND p.preference_value = '"dark"'
         ORDER BY u.id LIMIT 1`).get()
    || database.prepare('SELECT id, username FROM users ORDER BY id LIMIT 1').get();
  config = database.prepare("SELECT value FROM app_config WHERE key LIKE '%jwt%' LIMIT 1").get();
} catch (error) {
  database.close();
  die(`cannot read the users and app_config rows from ${DB_PATH}: ${error instanceof Error ? error.message : String(error)}`);
}
database.close();

if (!user) die(`no users row in ${DB_PATH} — this install has never been claimed`);

const secret = process.env.JWT_SECRET || config?.value;
if (!secret) die(`no JWT secret: neither JWT_SECRET in the environment nor an app_config row matching '%jwt%' in ${DB_PATH}`);

process.stdout.write(jwt.sign({ userId: user.id, username: user.username }, secret, { expiresIn: '10m' }));
