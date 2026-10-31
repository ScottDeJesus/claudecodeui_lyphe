import { DownloadIcon, FileArchiveIcon, FileCodeIcon, FileIcon, FileTextIcon } from 'lucide-react';
import { useState } from 'react';

import { api } from '@/shared/api';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { ChatAttachment } from '@/shared/types';
import { cn } from '@/shared/utils';

/** `default`, the chat's 256 px cards; `small`, 28 px pills on one line. */
type ChatFileSize = 'default' | 'small';

type ChatMessageFilesProps = {
  files: ChatAttachment[];
  /**
   * `default`: the chat's cards (the type's glyph, the name, the size, a download mark) in a row that wraps. `small`: 28 px pills,
   * the type's glyph and the name cut to one line, on one line that never wraps, each still a download on press and a 44 px catch
   * under a finger: the companion's strip at the top of her words in the station's portrait (MAN-569: the site that measured the
   * need decides the prop).
   */
  size?: ChatFileSize;
};

const formatFileSize = (size?: number) => {
  if (typeof size !== 'number') return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/** The glyph of a file's kind, drawn with `className`: one of four static icons, so no component is made during render. */
const getFileIcon = (file: ChatAttachment, className: string) => {
  const name = (file.name || file.path || '').toLowerCase();
  const mimeType = file.mimeType || '';
  if (mimeType.startsWith('text/') || /\.(md|txt|pdf|docx?)$/.test(name)) return <FileTextIcon className={className} aria-hidden />;
  if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return <FileArchiveIcon className={className} aria-hidden />;
  if (/\.(js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|css|html|json|ya?ml)$/.test(name)) return <FileCodeIcon className={className} aria-hidden />;
  return <FileIcon className={className} aria-hidden />;
};

function ChatMessageFile({ file, size }: { file: ChatAttachment; size: ChatFileSize }) {
  // The anchor is made in the window the row is drawn in.
  const hostWindow = useHostWindow();
  const [isDownloading, setIsDownloading] = useState(false);
  const name = file.name || file.path?.split(/[\\/]/).pop() || 'Attached file';
  const sizeLabel = formatFileSize(file.size);

  const download = async () => {
    if (!file.path || isDownloading) return;
    const storedName = file.path.split(/[\\/]/).pop();
    if (!storedName) return;

    setIsDownloading(true);
    try {
      const response = await api.assets.file(storedName);
      if (!response.ok) return;
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = hostWindow.document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = name;
      anchor.click();
      // Not the host window's timer: this releases a URL the OPENER's realm made, and a timer armed on
      // a floating window is cancelled if that window closes first — the blob would leak until unload.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
    } catch (error) {
      console.error(`Failed to download attachment "${name}":`, error);
    } finally {
      setIsDownloading(false);
    }
  };

  if (size === 'small') {
    return (
      // The pill keeps its 28 px to the eye; under a finger (a touch screen, or a window under 768 px) its catch grows to 44 px by a
      // transparent ::before (INV-10275), which the row's 16 px gap keeps clear of its neighbours'. The ::before stands on the padding
      // box, inside the 1 px border (26 px tall), so it reaches 9 px up and down: 44 px. The whole name is its name.
      <button
        type="button"
        onClick={() => void download()}
        disabled={!file.path || isDownloading}
        aria-label={`Download ${name}`}
        title={name}
        className="relative flex h-7 max-w-40 shrink-0 items-center gap-1.5 rounded-full border border-border/50 bg-card px-2.5 text-xs font-medium text-foreground transition-colors before:absolute before:inset-0 before:content-[''] hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-card finger:before:-inset-x-2 finger:before:-inset-y-[9px]"
      >
        {getFileIcon(file, cn('size-3.5 shrink-0 text-primary', isDownloading && 'animate-pulse'))}
        <span className="truncate">{name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={!file.path || isDownloading}
      className="group/file flex w-64 max-w-full items-center gap-3 rounded-xl border border-border/50 bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-card"
      aria-label={`Download ${name}`}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {getFileIcon(file, 'h-5 w-5')}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" title={name}>{name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sizeLabel || 'File attachment'}</p>
      </div>
      <DownloadIcon
        className={`h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover/file:text-foreground ${
          isDownloading ? 'animate-pulse' : ''
        }`}
        aria-hidden
      />
    </button>
  );
}

/**
 * Rendered by chat's MessageComponent to list the non-image file attachments
 * on a user turn as downloadable cards; exported through the chat barrel to the
 * companion module's `CompanionAttachments`, which draws the files he attached to a
 * typed line in her transcript (default) and in her portrait's strip (`small`).
 */
export default function ChatMessageFiles({ files, size = 'default' }: ChatMessageFilesProps) {
  if (!files?.length) return null;

  // Small stays one line; its gap grows to 16 px under a finger, so two 44 px catches never overlap.
  return (
    <div className={size === 'small' ? 'flex justify-end gap-1.5 finger:gap-4' : 'flex max-w-full flex-wrap justify-end gap-2'}>
      {files.map((file, index) => (
        <ChatMessageFile key={file.path || file.name || index} file={file} size={size} />
      ))}
    </div>
  );
}
