/**
 * The pipeline's one "a file was written" seam.
 *
 * `writeJob` and `writeStoredCheck` announce here after their rename lands, and the auto-install
 * switch's `setEnabled` after its `app_config` write: the report carries all three. The API's composition root
 * registers the paced `claude_updates_changed` hint; the detached update runner is a process of its own
 * with no sockets and registers nothing, so its writes are heard by the module's watch on the directory.
 */

type UpdateWrittenListener = () => void;

let listener: UpdateWrittenListener | null = null;

/** Registers the one listener; a second registration replaces the first. */
export function onUpdateFileWritten(next: UpdateWrittenListener): void {
  listener = next;
}

/** Called by a writer after its file is whole on disk. A no-op in a process that registered nothing. */
export function announceUpdateFileWritten(): void {
  listener?.();
}
