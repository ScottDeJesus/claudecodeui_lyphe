# The Claude Design authorization row

**Settings → Agents → Claude → Account** draws a second row directly under the sign-in row. Its
`Authenticate` button opens the embedded terminal on Claude Design's own claude.ai grant, which
DesignSync requires (`design/README.md`).

## The two rows

| | sign-in row | design row |
| --- | --- | --- |
| Modal title | `Claude CLI Login` | `Claude Design Login` |
| Command | `claude --dangerously-skip-permissions /login` | `claude --dangerously-skip-permissions /design-login` |
| `loginFlow` | `'account'` | `'design'` |
| Grants | the CLI's own credential | `user:design:read` + `user:design:write` on claude.ai/design projects |
| After the terminal exits | `handleLoginComplete` re-reads auth status, raises the save banner | nothing |

`/design-login` is the slash command DesignSync tells the user to run in the interactive TUI.
`claude design-login --json` is the VS Code extension's machine interface and answers in JSON lines;
it is not used here.

## Where each part lives

| File | Owns |
| --- | --- |
| `src/modules/settings/tabs/agents-settings/sections/content/AccountContent.tsx` | The row: drawn only when `agent === 'claude' && onDesignLogin`. No other gate — an `api_key` account sees it |
| `src/modules/settings/tabs/agents-settings/AgentsSettingsTab.tsx` | `onDesignLogin` set on `agentContextById.claude` only |
| `src/shared/types.ts` | `AgentContext.onDesignLogin?` |
| `src/modules/settings/hooks/useSettingsController.ts` | `loginFlow`, `openDesignLogin`, `openLoginForProvider` (sets `'account'`), `closeLoginModal`, the early return in `handleLoginComplete` |
| `src/modules/settings/Settings.tsx` | The modal's `customCommand` and `title`, read off `loginFlow`; `key={`${loginProvider \|\| 'claude'}:${loginFlow}`}` |
| `src/modules/provider-auth/ProviderLoginModal.tsx` | Optional `title`: `titleOverride ?? getProviderTitle(provider)` |
| `src/modules/i18n/locales/en/settings.json` | `agents.designLogin.{title,description,button}` — `en` only, the other locales fall back |

`AccountFooterRow` and `Onboarding` mount the modal without `title` or `customCommand`; their
titles and commands are unchanged.

## Rules

1. `loginFlow` is held state, never derived from `loginProvider`: both flows run on `claude`. A
   third flow adds a value to `LoginFlow`, not a provider id.
2. `closeLoginModal` is the only path that closes the modal and the only place the flow resets.
3. `handleLoginComplete` ends the design flow silently. A design grant changes no credential this
   pane reports; a re-check would relabel a healthy account.
4. The modal's `key` carries the flow, so a change of flow remounts the terminal instead of handing a
   new command to a pty already running the old one.
5. The description says read AND write: the CLI's own panel and the minted URL both carry both scopes.
6. The pty slot is keyed by a digest of the whole command
   ([docs/architecture/MANUAL.md (01-websocket-transport)](docs/architecture/MANUAL.md (01-websocket-transport)) §"The `/shell`
   socket"), so each row reattaches only to a pty running its own command.
7. A parked design pty lives `PTY_SESSION_TIMEOUT` (30 min). Another `Authenticate` press reattaches
   to the pending authorization; it does not mint a second.

## Proving it

```
node scripts/design-login-probe.mjs <app-url>
```

| Fact | Value |
| --- | --- |
| Token | minted by `scripts/universe-token.mjs`; the only argument is the app URL |
| Output | one `KEY=value` per reading, then `PROBE OK` (exit 0) or `PROBE FAILED` (exit 1); causes on stderr; missing argument exits 2 |
| Screenshots | `$DESIGN_LOGIN_PROBE_SHOTS`, default `/tmp/design-login-probe/` |
| Browser | playwright's `chrome-headless-shell`; `CHROME_HEADLESS_SHELL` overrides the path |
| Sign-in | never completed; the operator finishes the grant |
| Theme | flipped by the `dark` class on `<html>`, never the real toggle (it persists to `auth.db`) |
| Leaves behind | one parked pty per flow for `PTY_SESSION_TIMEOUT`; the next press of that row reattaches |
| Measured | 2026-09-23: `PROBE OK` on `:5183`, CLI v2.1.280, `CONSOLE_ERRORS=0` |

What it asserts, in order:

1. The design row sits directly under the sign-in row; title, description and button copy render.
2. The design modal titles `Claude Design Login`, mounts `.xterm`, and its terminal draws the
   `Design login` panel and an OAuth URL whose scope is `user:design:read+user:design:write`.
3. No `CLAUDECODE` session refusal, no non-interactive refusal, no unknown-command answer.
4. The sign-in modal titles `Claude CLI Login` and draws its own `Select login method` menu, never
   the design panel; the design modal never draws the sign-in menu.

A reading is believed only when it meets all three:

- It comes from `/shell` frames that arrive after `window.__shellMark`, set immediately before the
  press. xterm renders to canvas, so terminal text is never in the DOM.
- `[Reconnected to existing session]` is absent from those frames.
- `ps -eo args=` shows exactly one more process whose argv equals that flow's command, and no change
  for the other flow's. This is the only reading taken outside the browser.
