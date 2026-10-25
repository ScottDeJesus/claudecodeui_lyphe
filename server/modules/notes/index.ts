// createNotesModule: used by the server entrypoint to mount the notes lane's two doors — the tab's at
// `/api/notes` behind `authenticateToken`, and the `notes` command's at `/api/notes-cmd` behind the
// chat's own credential — one account's cards, read newest first and written one row at a time.
export { createNotesModule } from './notes.module.js';
