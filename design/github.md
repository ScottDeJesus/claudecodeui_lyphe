repo: ScottDeJesus/claudecodeui_lyphe
branch: main

## Last sync
date: 2026-09-04T18:05:00Z

### Updated in this project
- `CloudCLI Verve.dc.html` — the operator console reskinned on Verve (light/dark, desktop/mobile), with a full motion pass.
- Files tab reworked from a code editor into a file manager: browse, preview, upload, download.
- Git panel reduced to read-only status plus one agent-run `/git` push; commit/staging controls removed.
- New stubs: account switcher with re-auth, 5-hour/weekly/flexible usage meters, CLI-version awareness with session restart (`--resume`), Shell/Tasks tab visibility toggles, model and edit-mode pickers.
- `Verve Integration Handoff.dc.html` — printable developer handoff covering theme mapping and every stub's wiring.

## Screen map
| Screen | Built from |
| --- | --- |
| Sidebar | src/modules/sidebar/* |
| Header and tabs | src/modules/project-workspace/WorkspaceHeader.tsx, WorkspaceTabs.tsx, WorkspaceTitle.tsx, WorkspaceMain.tsx |
| Chat | src/modules/chat/* |
| Files | src/modules/file-tree/*, replaces src/modules/code-editor/* |
| Git | src/modules/git-panel/GitPanel.tsx |
| Shell | src/modules/shell/*, src/modules/standalone-shell/* |
| Tasks | src/modules/task-master/TaskCard.tsx |
| Settings | src/modules/settings/Settings.tsx |
| Sign in | src/modules/auth/LoginForm.tsx |
| Handoff / token mapping | src/index.css, tailwind.config.js, index.html |

## Sync history
- 2026-09-04T16:22:22Z — initial import and reskin of all nine screens.
