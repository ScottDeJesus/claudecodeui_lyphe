// Its consumers are the chat transcript's CodeBlock, which renders a `widget` fence as this, and the session
// panel's stage (`PanelStage`), which draws a chat's own live page with it.
export { WidgetFrame } from '@/modules/widgets/WidgetFrame';
// The embed frame on its own, for a surface that has already decided WHICH address it is drawing and
// owns the box it goes in: the session panel's stage (`PanelStage`), for a page a chat put there. There is
// one embed frame in this app, and this is it — a second one would be a second answer about sandboxes,
// origins and loopback.
export { EmbedUrlFrame } from '@/modules/widgets/EmbedUrlFrame';
// The loopback correction, for a surface that shows an embed's address as a LINK rather than as a
// frame: a link is followed by the same browser the frame is loaded in, so it must name the same
// reachable host. The session panel's stage (`PanelStage`) is that surface.
export { resolveEmbedUrl } from '@/modules/widgets/embedUrl';
// A link into DocSpace's studio for a page, or one block of it, built on that same origin: the ONE builder of a DocSpace page
// link. Its consumers are src/modules/companion (Settings' "Open the memory") and src/modules/station (the page stage's
// "Open in DocSpace" and the note stage's page card).
export { docSpacePageUrl } from '@/modules/widgets/docspaceOrigin';
