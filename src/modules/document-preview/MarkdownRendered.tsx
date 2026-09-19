import { useEffect, useState } from 'react';

import { MarkdownPreview } from '@/modules/markdown-preview';
import type { DocumentViewProps } from '@/shared/types';

/**
 * A Markdown file, drawn the way a reader sees it rather than as its source lines.
 *
 * Used by this module's DocumentPreview (through the registry) for the Rendered view of a `.md`,
 * `.markdown` or `.mdx` file; the header's Source toggle goes back to the numbered lines.
 *
 * It is the app's own MarkdownPreview — the renderer the PRD editor uses — set in the prose
 * measure the kanban drawer reads it in, so a document looks the same wherever the app draws one.
 */
export function MarkdownRendered({ blob }: DocumentViewProps) {
  // The file's own text. It is read asynchronously, so it is state: empty until the text arrives,
  // and never the previous file's text once a new one does.
  const [content, setContent] = useState('');

  useEffect(() => {
    let cancelled = false;
    void blob.text().then((text) => {
      if (!cancelled) {
        setContent(text);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blob]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      <div className="prose prose-sm max-w-none break-words dark:prose-invert">
        <MarkdownPreview content={content} />
      </div>
    </div>
  );
}
