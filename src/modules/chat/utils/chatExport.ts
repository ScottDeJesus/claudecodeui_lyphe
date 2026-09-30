/**
 * Turns a loaded transcript into a downloadable file.
 *
 * The HTML path renders the app's real transcript components, so an exported
 * conversation looks like the one on screen — tool cards, diffs, highlighted
 * code, subagent timelines and all. Markdown and JSON are the plain-text and
 * machine-readable views of the same messages.
 */

import type { ChatMessage, DiffLine, LLMProvider, Project } from '@/shared/types';
import { buildTranscriptHtml } from '@/modules/chat/export/buildTranscriptHtml';
import { buildTranscriptMarkdown } from '@/modules/chat/export/buildTranscriptMarkdown';

export type TranscriptExportFormat = 'html' | 'markdown' | 'json';

export type TranscriptExportInput = {
  messages: ChatMessage[];
  sessionTitle: string;
  provider: LLMProvider | string;
  selectedProject?: Project | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  /**
   * Turns a model id into the catalog's name for it. Optional because the
   * markdown and JSON formats carry the id itself; the HTML export mounts the
   * on-screen components, so without this the file it saves captions every turn
   * with the provider's name while the screen said the model's.
   */
  resolveModelLabel?: (modelId: string) => string | null;
};

const EXTENSIONS: Record<TranscriptExportFormat, string> = {
  html: 'html',
  markdown: 'md',
  json: 'json',
};

const MIME_TYPES: Record<TranscriptExportFormat, string> = {
  html: 'text/html;charset=utf-8',
  markdown: 'text/markdown;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

/**
 * Makes a session title safe to use as a filename.
 *
 * Session titles are the user's first message, so they routinely contain
 * slashes and quotes; unsanitized they produced downloads named after only the
 * last path segment, or nothing at all.
 */
export function toExportFileStem(sessionTitle: string, exportedAt: Date): string {
  const date = exportedAt.toISOString().slice(0, 10);
  const slug = sessionTitle
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase();

  return slug ? `${slug}-${date}` : `conversation-${date}`;
}

/**
 * The anchor is made, attached and clicked in `hostDocument`, the document the press happened in:
 * an anchor clicked in a document the reader is not looking at is a download the browser may
 * discount, and a helper at module level has no window of its own to ask.
 */
function downloadBlob(blob: Blob, filename: string, hostDocument: Document): void {
  const url = URL.createObjectURL(blob);
  const link = hostDocument.createElement('a');
  link.href = url;
  link.download = filename;
  hostDocument.body.appendChild(link);
  link.click();
  hostDocument.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Builds the file's text without downloading it, so it can be asserted on.
 *
 * `sourceDocument` is the document whose theme and stylesheets the HTML file carries: the caller's
 * host document. The default is the page's own, for a caller that builds the text with no press
 * behind it.
 */
export async function buildTranscriptExport(
  format: TranscriptExportFormat,
  input: TranscriptExportInput,
  exportedAt: Date,
  sourceDocument: Document = document,
): Promise<string> {
  if (format === 'json') {
    return `${JSON.stringify(
      {
        title: input.sessionTitle,
        provider: input.provider,
        exportedAt: exportedAt.toISOString(),
        messageCount: input.messages.length,
        messages: input.messages,
      },
      null,
      2,
    )}\n`;
  }

  if (format === 'markdown') {
    return buildTranscriptMarkdown({
      messages: input.messages,
      sessionTitle: input.sessionTitle,
      provider: input.provider,
      exportedAt,
      createDiff: input.createDiff,
      resolveModelLabel: input.resolveModelLabel,
    });
  }

  return buildTranscriptHtml({
    messages: input.messages,
    createDiff: input.createDiff,
    provider: input.provider,
    selectedProject: input.selectedProject,
    resolveModelLabel: input.resolveModelLabel,
    sessionTitle: input.sessionTitle,
    exportedAt,
    sourceDocument,
  });
}

/** Used by chat's ChatExportMenu, which passes the document it is drawn in as `hostDocument`. */
export async function downloadTranscriptExport(
  format: TranscriptExportFormat,
  input: TranscriptExportInput,
  hostDocument: Document,
): Promise<void> {
  const exportedAt = new Date();
  const content = await buildTranscriptExport(format, input, exportedAt, hostDocument);
  const filename = `${toExportFileStem(input.sessionTitle, exportedAt)}.${EXTENSIONS[format]}`;

  downloadBlob(new Blob([content], { type: MIME_TYPES[format] }), filename, hostDocument);
}
