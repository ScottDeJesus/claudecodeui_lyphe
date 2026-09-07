import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import { Button, EmptyState, Spinner } from '@/shared/ui';
import { formatBytes, formatRelativeTime } from '@/shared/utils';
import type { FilePreview } from '@/shared/types';

/** What the preview pane needs; rendered by the file-manager module's FileManager. */
type PreviewPaneProps = {
  projectId: string;
  /** The selected file, project-relative. Null when nothing is selected. */
  selectedPath: string | null;
  preview: FilePreview | null;
  /** The server's own sentence when this file could not be read. */
  error: string | null;
  onDownload: () => void;
};

/** Joins the facts the app actually has into one meta line, dropping the ones it does not. */
const metaLine = (parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' · ');

/** `image/png` reads as `PNG image`; a MIME with no subtype just says `image`. */
const imageKindLabel = (mime: string) => {
  const subtype = mime.split('/')[1];
  return subtype ? `${subtype.toUpperCase()} image` : 'image';
};

/**
 * The right-hand pane: what one file looks like, read-only.
 *
 * Used by the file-manager module's FileManager, which owns the selection this reads.
 *
 * Three arms and nothing else, because `FilePreview` has three: text is shown with its line
 * numbers and told plainly that it cannot be edited here, an image is loaded through the content
 * stream and MEASURED by the browser, and a binary is offered as a download. A figure the app has
 * not learned yet is not drawn at all — the `1440 × 900` appears only once `onLoad` has fired,
 * never as a pair of zeros while the bytes are still arriving.
 */
export function PreviewPane({ projectId, selectedPath, preview, error, onDownload }: PreviewPaneProps) {
  // The bytes this pane has loaded, and the pixel size the browser measured off them — each
  // tagged with the file it belongs to. Tagged rather than cleared when the selection moves,
  // because the tag is what keeps the PREVIOUS file's picture and `×` figure off the screen for
  // the frames before the new ones arrive. Two records rather than one: the URL is known well
  // before the size is, and a single record would have to invent a size to hold the URL.
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null);
  const [measured, setMeasured] = useState<{ path: string; width: number; height: number } | null>(null);

  const isImage = preview?.kind === 'image';
  const imagePath = isImage ? selectedPath : null;
  const settledImage = imagePath && loaded?.path === imagePath ? loaded : null;
  const imageUrl = settledImage?.url ?? null;
  const imageFailed = settledImage !== null && settledImage.url === null;
  const dimensions = imagePath && measured?.path === imagePath ? measured : null;

  useEffect(() => {
    if (!imagePath) {
      return undefined;
    }

    let objectUrl: string | null = null;
    const controller = new AbortController();

    void (async () => {
      try {
        const response = await api.readFileBlob(projectId, imagePath, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setLoaded({ path: imagePath, url: objectUrl });
      } catch (cause) {
        if (cause instanceof Error && cause.name === 'AbortError') {
          return;
        }
        // A settled record with no URL: the pane says the bytes did not arrive rather than
        // spinning forever on a load that is over.
        setLoaded({ path: imagePath, url: null });
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imagePath, projectId]);

  const fileName = selectedPath?.split('/').pop() ?? '';

  return (
    <section aria-label="File preview" className="flex min-h-[260px] min-w-0 flex-1 basis-[260px] flex-col overflow-hidden">
      <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <span className="text-xs uppercase tracking-[0.14em] text-ink-faint">Preview</span>
        {selectedPath && (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onDownload}>Download</Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!selectedPath && (
          <div className="p-4">
            <EmptyState title="No file chosen" message="Pick a file on the left to read it here." />
          </div>
        )}

        {selectedPath && error && (
          <p className="px-4 py-4 text-[13px] text-warn-ink">▲ {error}</p>
        )}

        {selectedPath && !error && !preview && (
          <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-ink-faint">
            <Spinner />
            <span>Reading {fileName}…</span>
          </div>
        )}

        {preview?.kind === 'text' && (
          <div className="flex flex-col">
            <div className="flex flex-col gap-1 border-b border-border px-4 pb-2.5 pt-3.5">
              <div className="text-sm font-medium">{fileName}</div>
              <div className="text-[12.5px] text-muted-foreground">
                {metaLine([
                  preview.language,
                  preview.bytes !== null && formatBytes(preview.bytes),
                  preview.totalLines !== null && `${preview.totalLines} lines`,
                  preview.mtime !== null && `changed ${formatRelativeTime(preview.mtime)}`,
                ])}
              </div>
            </div>

            <div className="overflow-x-auto py-3 font-mono text-[12.5px] leading-[1.85]">
              {preview.lines.map((line, index) => (
                // The line number IS the identity here: this body is replaced whole when the file
                // changes, and a file has no other key for a row that may repeat verbatim.
                <div key={index} className="flex gap-3.5 px-4">
                  <span className="w-6 flex-none select-none text-right text-ink-faint">{index + 1}</span>
                  <span className="whitespace-pre text-muted-foreground">{line}</span>
                </div>
              ))}
            </div>

            <div className="px-4 pb-4 text-[12.5px] text-ink-faint">
              {preview.totalLines !== null
                ? `First ${preview.lines.length} of ${preview.totalLines} lines.`
                : `First ${preview.lines.length} lines.`}
              {' '}Editing happens in your own editor — ask an agent here to change the file.
            </div>
          </div>
        )}

        {preview?.kind === 'image' && imagePath && (
          <div className="flex flex-col">
            <div className="flex flex-col gap-1 border-b border-border px-4 pb-2.5 pt-3.5">
              <div className="text-sm font-medium">{fileName}</div>
              <div className="text-[12.5px] text-muted-foreground">
                {metaLine([
                  imageKindLabel(preview.mime),
                  preview.bytes !== null && formatBytes(preview.bytes),
                  // Only once the browser has measured it. A figure before then would be a guess.
                  dimensions && `${dimensions.width} × ${dimensions.height}`,
                  preview.mtime !== null && formatRelativeTime(preview.mtime),
                ])}
              </div>
            </div>

            <div className="flex items-center justify-center p-4">
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt={fileName}
                  className="max-h-[50vh] max-w-full rounded-[10px] border border-border object-contain"
                  onLoad={(event) => setMeasured({
                    path: imagePath,
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })}
                />
              )}
              {!imageUrl && imageFailed && (
                <p className="text-[12.5px] text-warn-ink">▲ The image could not be loaded.</p>
              )}
              {!imageUrl && !imageFailed && (
                <div className="flex items-center gap-2 text-[12.5px] text-ink-faint">
                  <Spinner />
                  <span>Loading the image…</span>
                </div>
              )}
            </div>
          </div>
        )}

        {preview?.kind === 'none' && (
          <div className="p-5">
            <EmptyState
              title="No preview for this file"
              message={`${metaLine([fileName, preview.bytes !== null && formatBytes(preview.bytes)])}. Download it to open it in a tool that understands the format.`}
              actionLabel="Download the file"
              onAction={onDownload}
            />
          </div>
        )}
      </div>
    </section>
  );
}
