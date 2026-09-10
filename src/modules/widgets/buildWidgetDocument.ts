import { WIDGET_BRIDGE_SCRIPT } from '@/modules/widgets/widgetBridgeScript';

/**
 * Builds the whole HTML document one widget lives inside.
 *
 * Two things make up the fence, and they close different holes. The `sandbox` attribute on the
 * iframe (see `WidgetFrame`) keeps the widget off the parent's origin, so it can never read the
 * page's storage, its cookies or its DOM — a sandboxed frame can still talk to the network
 * perfectly well, which is what the CSP below is for. Neither is sufficient alone, and loosening
 * either one "to make something work" is the change that has to be refused.
 *
 * WHAT THE CSP CLOSES, measured rather than assumed — twelve vectors driven through a real frame
 * carrying exactly this policy. Eleven are refused: `fetch`, `XMLHttpRequest`, `WebSocket`,
 * `EventSource`, `sendBeacon`, an image, a script, a stylesheet, a NESTED iframe, a form submit
 * and `window.open`. ONE is not: the frame may navigate ITSELF (`location.href = …`), and that
 * navigation issues a real request carrying whatever the widget wrote into the URL.
 *
 * That hole is the platform, not an oversight to patch here. `connect-src` never governed
 * navigation; `navigate-to` was never shipped (Chromium answers it "Unrecognized … directive");
 * `frame-src` governs neither document's own self-navigation, on the parent or in here; and a
 * sandboxed context may always navigate itself, whatever `allow-top-navigation` says. No shipped
 * control closes it — so do not add a directive in the belief that it does. Measure it again.
 *
 * What bounds the damage is that the frame holds nothing of ours to spend: opaque origin, no
 * storage, no parent DOM. A widget can leak only what the host POSTED to it, which is why the
 * topic allowlist on the host side is the real control on exfiltration rather than a formality.
 * And because a nested frame is refused, the exit cannot be taken quietly: the widget must
 * navigate itself away to use it, and a widget that vanishes is one the reader watches vanish.
 *
 * Interpolation is deliberately narrow: token values reach the `<style>` block and nothing else,
 * the fence body reaches the `<body>` element and nothing else. The body is model output and is
 * treated as untrusted — it is never spliced into a script, an attribute or the CSP.
 */
export const WIDGET_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/**
 * The frame's own reset. `--canvas` and `--ink` come across as copied values, so a widget that
 * draws nothing still reads as part of the page rather than as a white rectangle in a dark app.
 */
const DOCUMENT_RESET =
  'html,body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--font-body);font-size:var(--text-body)}';

/**
 * Token values come from `getComputedStyle` on our own document element, so they are CSS values
 * we authored; this is depth behind the CSP and the sandbox, not the thing holding the line.
 *
 * What it strips is exactly what could end one construct early and begin another: `}` closes the
 * `:root` rule, after which a value writes free-standing CSS; `;` ends the declaration and lets a
 * value smuggle a second one in beside it; `<` and `>` could close the `<style>` element itself.
 * `{` goes with `}` so neither half can be smuggled alone. No Verve token value contains any of
 * them, so the cost of refusing them is nothing — and a sanitizer that stopped at angle brackets
 * would imply a coverage it did not have, which is worse than no sanitizer at all.
 */
function sanitizeTokenValue(value: string): string {
  return value.replace(/[<>{};]/g, '');
}

/**
 * @param input.body   The fence body verbatim — the model's own HTML.
 * @param input.dark   Whether the page is currently in dark mode.
 * @param input.tokens The Verve tokens to declare on `:root`, from `readVerveTokens()`.
 */
export function buildWidgetDocument(input: { body: string; dark: boolean; tokens: Record<string, string> }): string {
  const declarations = Object.entries(input.tokens)
    .map(([name, value]) => `${name}:${sanitizeTokenValue(value)}`)
    .join(';');

  // The CSP meta stands before every style and every script, and above all before the body:
  // a policy declared after the content it governs arrives too late to govern it.
  return [
    '<!doctype html>',
    input.dark ? '<html class="dark">' : '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">`,
    `<style>:root{${declarations}}${DOCUMENT_RESET}</style>`,
    `<script>${WIDGET_BRIDGE_SCRIPT}</script>`,
    '</head>',
    `<body>${input.body}</body>`,
    '</html>',
  ].join('\n');
}
