// The warden's one way of speaking: a line on stdout that journald files under the unit and that a
// person reading `journalctl -u cerberus-warden` can tell from any other process's by its prefix.
// A secret never goes through here — the enrollment token and the node key are not log material.

/** Writes `[warden] <message>` on stdout. */
export function log(message) {
  console.log(`[warden] ${message}`);
}
