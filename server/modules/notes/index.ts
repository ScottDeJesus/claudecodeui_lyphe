// createNotesModule: used by the server entrypoint to mount the notes lane's two doors — the tab's at
// `/api/notes` behind `authenticateToken`, and the `notes` command's at `/api/notes-cmd` behind the
// chat's own credential — one account's cards, read newest first and written one row at a time.
export { createNotesModule } from './notes.module.js';
// notesService: used by the companion's panel reads (`companion/eyes/notes-reads.ts`, her `read_notes`) — the Notes tab's own
// verbs, of which she calls `list` and `get` and never a write.
export { notesService } from './notes.service.js';
