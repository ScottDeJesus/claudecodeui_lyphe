/**
 * The Cerberus store's connection: a second SQLite file beside `auth.db`, with its own singleton.
 *
 * WHY THIS IS A SECOND SINGLETON HERE AND NOT A CONNECTION THE CERBERUS MODULE OPENS FOR ITSELF:
 * `connection.ts:9-10` says "Consumers should never create their own Database instance — they use
 * `getConnection()` to obtain the shared singleton." The cerberus module is a consumer, so it may
 * not `new Database(...)` its own file either; the rule only keeps holding if the second file gets
 * the same treatment as the first — one handle per file, its path resolved in one place, its
 * schema applied before anyone can read it, its close reachable from the database barrel. This
 * module is that treatment. Its repositories (`repositories/cerberus-*.db.ts`) take
 * `getCerberusConnection()` the way `notes.db.ts` takes `getConnection()`, and the cerberus
 * module reaches all of it through `index.ts`.
 *
 * WHY A FILE OF ITS OWN: the store is an append stream (results, forever) with a schema counted by
 * `PRAGMA user_version`, while `auth.db` rebuilds idempotent DDL at every boot. Sharing a file
 * would make the two schemas' lifecycles — and the two writers' lock — one.
 *
 * Nothing opens it at import. The first `getCerberusConnection()` call does, and the cerberus
 * module's `start()` is that call.
 */

import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { getDatabasePath } from '@/modules/database/connection.js';
import { CERBERUS_MIGRATIONS } from '@/modules/database/cerberus-schema.js';

let instance: Database.Database | null = null;

/**
 * Resolves the store's file path without opening it.
 *
 * Priority:
 *   1. CERBERUS_DB_PATH environment variable
 *   2. `cerberus.db` beside the main database (`getDatabasePath()` has already resolved
 *      DATABASE_PATH and its fallback — so a server booted on a scratch DATABASE_PATH gets a
 *      scratch store, and live it is `~/.cloudcli/cerberus.db`)
 *
 * Consumer: the cerberus module's `center-key.ts`, which keeps the center's signing key beside the
 * store, and the connection below.
 */
export function getCerberusDatabasePath(): string {
  return process.env.CERBERUS_DB_PATH || path.join(path.dirname(getDatabasePath()), 'cerberus.db');
}

/**
 * Applies every migration step the file has not yet had, in order.
 *
 * Two API processes overlap on every handover, and both run this on their first open. Each step
 * runs inside `BEGIN IMMEDIATE`: the write lock is taken BEFORE `user_version` is read, so the
 * process that gets the lock applies the step and the other, once the lock frees, re-reads a
 * counter that has moved on and does nothing. A plain (deferred) transaction would let both read
 * `i`, and the second would then fail on its first `CREATE TABLE`.
 */
function applyMigrationSteps(db: Database.Database): void {
  // The cheap path, taken at nearly every open: a current file needs no write lock at all. A
  // counter AHEAD of this build's steps (a rollback to an older build) is left alone too — steps
  // only ever add, so the older build still reads and writes the columns it knows.
  if ((db.pragma('user_version', { simple: true }) as number) >= CERBERUS_MIGRATIONS.length) return;

  CERBERUS_MIGRATIONS.forEach((stepSql, stepIndex) => {
    db.transaction(() => {
      const appliedSteps = db.pragma('user_version', { simple: true }) as number;
      if (appliedSteps !== stepIndex) return; // another process applied it, or it ran before

      db.exec(stepSql);
      // PRAGMA takes no bound parameter; the value is arithmetic on our own loop index.
      db.pragma(`user_version = ${stepIndex + 1}`);
    }).immediate();
  });
}

/**
 * Returns the shared Cerberus connection, creating it on first call.
 *
 * The first invocation:
 *   1. Resolves the file path
 *   2. Ensures the parent directory exists
 *   3. Opens the SQLite connection
 *   4. Sets `busy_timeout = 5000`, `journal_mode = WAL` and `foreign_keys = ON`
 *   5. Runs the migration steps the file has not had
 *
 * The singleton is assigned only after step 5 succeeds, so a failed migration leaves nothing
 * half-open: the handle is closed, the error propagates, and the next call starts over.
 *
 * Consumers: the five `cerberus-*.db.ts` repositories (a call inside every method), and the cerberus
 * module's `start()` (the first call, which creates the file) and its multi-statement transactions
 * (`ingest`, a definitions write), which open on this connection.
 */
export function getCerberusConnection(): Database.Database {
  if (instance) return instance;

  const dbPath = getCerberusDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  try {
    // busy_timeout first: switching a fresh file to WAL takes a lock, and the overlapping
    // process of a handover may hold it at that very moment.
    db.pragma('busy_timeout = 5000');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    applyMigrationSteps(db);
  } catch (err) {
    db.close();
    console.error('Could not open the Cerberus store', {
      path: dbPath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  console.log('Cerberus store opened:', dbPath);
  instance = db;
  return instance;
}

/**
 * Closes the Cerberus connection and clears the singleton, so the next
 * `getCerberusConnection()` opens the file afresh.
 *
 * Consumers: the `store`, `read-model` and `gateway` probes in `.verify/probe-cerberus-*.mjs`, which
 * close it as their last act (`probe-cerberus-store.mjs` also reopens it once, to prove the steps
 * idempotent).
 * The server never calls it: `cerberus.module.ts`'s `stop()` stops the self-checks, the prune and
 * the gateway's accepting, and the handle closes with the process.
 */
export function closeCerberusConnection(): void {
  if (instance) {
    instance.close();
    instance = null;
    console.log('Cerberus store closed');
  }
}
