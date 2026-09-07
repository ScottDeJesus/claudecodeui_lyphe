# Design source — pulled from the Claude Design canvas

Project: **Git repo design system application**
`https://claude.ai/design/p/155403fb-bd1c-4620-a789-304ddd2961a6`
Pulled 2026-09-04 via DesignSync (requires `/design-login`).

| File | What it is |
|---|---|
| `CloudCLI Verve.dc.html` | The prototype — all nine screens of the console reskinned on Verve, light/dark, desktop/mobile, full motion pass. Appearance-and-behaviour reference only: no API calls, no routing, no persisted state. |
| `Verve Integration Handoff.dc.html` | The developer handoff — theme-token mapping, the six stubs and where each belongs in this repo, rules to preserve, open questions. |
| `github.md` | The canvas's own sync manifest, incl. the screen → source-module map. |
| `_ds/verve-design-system-…/` | Verve tokens + component bundle the prototype links against. |
| `support.js` | Canvas runtime shim the `.dc.html` files load. Needs `window.React`/`window.ReactDOM` to render outside the canvas. |

Not pulled: `doc-page.js` (paged-document shell used only by the handoff's print layout)
and `_ds_manifest.json` / `_adherence.oxlintrc.json` (canvas-side metadata).
Read them from the canvas if ever needed.

Verifying a change made against these designs — the dev server, the mechanical baseline, and
the browser harness — is [`docs/verification.md`](../docs/verification.md). How the Verve
tokens are wired into the running app is [`src/shared/ui/verve/README.md`](../src/shared/ui/verve/README.md).
