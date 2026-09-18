// The chat transcript's CodeBlock is the only consumer: it renders a `widget` fence as this.
export { WidgetFrame } from '@/modules/widgets/WidgetFrame';
// The embed frame on its own, for a surface that has already decided WHICH address it is drawing and
// owns the box it goes in: the chat's Embed gutter widget. There is one embed frame in this app, and
// this is it — a second one would be a second answer about sandboxes, origins and loopback.
export { EmbedUrlFrame } from '@/modules/widgets/EmbedUrlFrame';
// The one classifier. Exported for the same widget, which validates a hand-typed address by asking
// the question the transcript already asks of a fence body, rather than by writing a second gate.
export { classifyWidgetBody } from '@/modules/widgets/classifyWidgetBody';
// The loopback correction, for a surface that shows an embed's address as a LINK rather than as a
// frame: a link is followed by the same browser the frame is loaded in, so it must name the same
// reachable host. `EmbedWidgetBody` is that surface.
export { resolveEmbedUrl } from '@/modules/widgets/embedUrl';
// Where ArchPulse is, for a surface that OFFERS it rather than embeds a block of it: the Embed
// widget's dropdown. Exported so that question keeps ONE answer — the same resolver the DocSpace
// frame uses, honouring `VITE_DOCSPACE_EMBED_ORIGIN` and the page's own hostname alike.
export { resolveDocSpaceOrigin } from '@/modules/widgets/docspaceOrigin';
