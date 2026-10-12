// One daemon per home. Center closes the older link of a node when a newer one connects (code 4000,
// "replaced"), and a warden reads any close as a loss and reconnects: two daemons on one home would
// take the link from each other about once a second, and both would rewrite one `state.json`.
//
// The lock is a listening socket in Linux's abstract unix namespace, named for the home. The kernel
// grants a name to one listener at a time and frees it the instant its process dies — however it dies —
// so there is no lock file to go stale and nothing to poll or to clean up after a crash or a SIGKILL.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';

function lockName(home) {
  let identity = home;
  try {
    identity = fs.realpathSync(home); // two spellings of one directory (a symlink) are one home
  } catch {
    // A home that cannot be resolved is named as given: the lock is only ever less shared, never wrong.
  }
  return `\0cerberus-warden:${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

/**
 * Tries to become the one daemon of `home`. Resolves `'held'` (this process is it), `'taken'` (another
 * daemon already is) or the error code of a platform that cannot say — the caller then goes on without
 * a lock rather than refuse to report, since a warden that is not running helps no one.
 */
export function takeHomeLock(home) {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.destroy()); // nobody is meant to connect
    server.once('error', (error) => resolve(error.code === 'EADDRINUSE' ? 'taken' : (error.code ?? 'unavailable')));
    try {
      // The listener is the lock, and an open listener lives as long as the process does.
      server.listen(lockName(home), () => resolve('held'));
    } catch (error) {
      resolve(error.code ?? 'unavailable');
    }
  });
}
