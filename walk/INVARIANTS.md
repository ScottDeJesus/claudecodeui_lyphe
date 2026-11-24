<!-- docstore export; edit rows with docstore write, never this file -->

## INV-11928 — walk/ — a change that moves a screen updates walk/screens.toml in the same change

CloudCLI's walk folder, read by the house's walk library (hooks/web_walk/node): `walk/screens.toml` names every screen a walk or `web-walk reach cloudcli` can open, and `walk/app.mjs` is the adapter (sign-in as the .verify kit's DEV_USER through /api/auth/login seeded as localStorage auth-token; the stored theme pinned with themeFollowsSun off on this context's own /api/user/preferences reads, writes answered and dropped; ready = the workspace on screen, stepping from the sessions home to /?walk; unfold = close an open Settings panel, then open the phone drawer when the Places menu is not in reach).

**The rule.** A change that moves a screen (a place, a Settings tab, an Analytics section, a heading or label an entry's landmark or steps name) updates walk/screens.toml in the same change, and `~/.claude/scripts/web-walk reach cloudcli` reads every line reached before it lands. An entry names things by role, name, label or text only, never a position, holds no address (those are the registry's, hooks/web_walk/apps.toml), and no entry sends a chat turn. Views and Settings are reached through the Places menu (button Menu, then the menuitem in the menu Places), since the Views rail is set aside while a chat holds the workspace; capitalised headings are matched with exact = false. `[app] mark` lists `data-hoop-row` (the ticket id) and `data-hoop-row-state`: `{mark: "c-814"}` or `{mark: "working"}` finds the row.

governs: /home/lyphe/.claude/claudecodeui_lyphe/walk/app.mjs, /home/lyphe/.claude/claudecodeui_lyphe/walk/screens.toml
