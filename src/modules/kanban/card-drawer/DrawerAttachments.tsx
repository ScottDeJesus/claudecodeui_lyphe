import { AlertCircle, File as FileIcon, FileImage, FileText, Trash2, UploadCloud, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import { api, readApiJson } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { KanbanAttachment, KanbanCardDetail } from '@/shared/kanban-types';
import { Badge, Button, Spinner } from '@/shared/ui';
import { cn, downloadBlobAsFile, formatBytes } from '@/shared/utils';

/**
 * WHAT IS PINNED TO THE CARD: the files a person or a build left on it, and the one place to add
 * another.
 *
 * ON EVERY CARD, WHATEVER AUTONOMY SAYS. Attachments are the operator's own — a screenshot of the
 * bug, the PDF the customer sent — and belong to the card the way its title does. The three
 * sections autonomy hides are the RUN's ledger; this one is the card's, so the shell mounts it
 * beside the body and never inside the gated block.
 *
 * ONE ROW SHAPE, THREE STATES. A stored file, a file on its way up and a file the server refused
 * all sit in the same list with the same three columns — a slot, a name with its figures, a
 * control — so the eye reads down one column of names rather than three different widgets. What
 * changes between them is the slot and the tone: a stored image shows its own pixels, a file in
 * flight shows the house ring, a refusal shows the danger glyph and the server's sentence in red.
 * Red is spent on the refusal alone, because it is the only thing here that asks to be acted on.
 *
 * THE PREVIEW IS NEVER `<img src={route}>`. The bytes sit behind a bearer token a bare image tag
 * cannot carry; the slot takes an object URL the fill phase makes from a fetched blob, exactly as
 * chat's own images do (`ChatMessageImages.tsx`), and draws the kind glyph until it has one.
 *
 * THIS SECTION FETCHES NOTHING. The rows are `detail.attachments`, read once by the shell with the
 * rest of the card, and every write below is a verb on `useKanbanMutations` handed down by the
 * shell — a second fetcher here would let this list disagree with the count on the card's face.
 */

type DrawerAttachmentsProps = {
  /** The open card, as the shell read it. This section fetches nothing. */
  detail: KanbanCardDetail;
  /** The board's verbs, from the shell. This section reaches the network through none of its own. */
  writes: KanbanMutations;
};

/**
 * A file on its way to the card, or one that did not make it. Local to this section: the server
 * knows nothing of a row until its bytes land, so these never come from `detail`. `key` is minted
 * here when the file is picked — never the server's `a-<n>` — so a refused row can be dismissed.
 */
type UploadRow = { key: string; filename: string; size: number } & (
  | { state: 'uploading' }
  | { state: 'failed'; reason: string }
);

/** What the picker offers and what the drop zone says: the server's own allowlist and cap
 *  (`ATTACHMENT_MIME_TO_EXT`, `ATTACHMENT_MAX_BYTES`), spelled here as copy — the server is the gate. */
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf';

/** The glyph and the word for a mime, so a row says what it is without a thumbnail. */
function kindOf(mime: string): { icon: typeof FileIcon; label: string; image: boolean } {
  if (mime.startsWith('image/')) return { icon: FileImage, label: 'Image', image: true };
  if (mime === 'application/pdf') return { icon: FileText, label: 'PDF', image: false };
  return { icon: FileIcon, label: 'File', image: false };
}

/** Rendered by KanbanCardDrawer on every card, beside DrawerBody. Nothing else mounts it. */
export function DrawerAttachments({ detail, writes }: DrawerAttachmentsProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const headingId = useId();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const stored = detail.attachments.length;

  // THE ROWS THIS SECTION OWNS are the ones the server has NOT answered for yet. A file sits here
  // from the moment it is picked until its write lands or is refused, and never after: a stored row
  // arrives in `detail.attachments` with the frame the write broadcast, so this list can never
  // disagree with the count on the card's face.
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const nextUploadKey = useRef(0);

  /**
   * One file, one row, one write.
   *
   * The key is minted here, never the server's `a-<n>`: the row has to exist while the server has
   * nothing to name yet, and a refusal has to have something the reader can dismiss.
   *
   * THE ROW LEAVES `uploading` IN THE `finally`, whichever way the write went. A refusal marks the
   * row failed rather than clearing it — a file the card did not take is a thing the reader has to
   * see — because a ring that rides on with nothing behind it reads as a slow upload about a
   * request that is already over. The server's own sentence reaches the reader through the toast
   * every verb raises on a refusal; what this row adds is which file it was about.
   */
  const uploadOne = useCallback(
    async (file: File) => {
      const key = `upload-${nextUploadKey.current++}`;
      setUploads((held) => [...held, { key, filename: file.name, size: file.size, state: 'uploading' }]);

      // The row names WHAT IS TRUE — the file did not land — and never a cause it cannot know: the
      // mutation answers the route's payload and nothing else, so a 413, a 422 and a network drop
      // are indistinguishable here, and a guessed reason would state a wrong fact in red. The
      // server's own sentence is one line away, in the toast the refusal raised.
      const refusal = t('kanban.attachments.refused', {
        defaultValue: 'That file did not land on the card',
      });

      let landed: KanbanAttachment | null = null;
      try {
        landed = await writes.uploadAttachment(detail.id, file);
      } finally {
        setUploads((held) =>
          landed === null
            ? held.map((row) => (row.key === key ? { ...row, state: 'failed', reason: refusal } : row))
            : held.filter((row) => row.key !== key)
        );
      }
    },
    [writes, detail.id, t]
  );

  const onSelectFiles = (files: File[]): void => {
    for (const file of files) void uploadOne(file);
  };

  // The removal is the whole of it. The write lands, the server broadcasts the card, and the
  // drawer's own re-read repaints this list without the row — so nothing is taken off the screen
  // here. A row that vanished before the server said so would be a list disagreeing with the face.
  const onRemove = (attachmentId: string): void => {
    void writes.removeAttachment(detail.id, attachmentId);
  };

  // The name is the press that opens the file, and this is the read behind it: the bytes through the
  // bearer token, onto the reader's disk under the row's own display name (never the stored one).
  //
  // AND IT SAYS SO WHEN IT FAILS. A row's file can be gone from under the row — the service answers
  // a 404 for exactly that — and a press that changes nothing visible reads as a dead button. The
  // failure goes to the same place every other verb's refusal does, the toast, with the server's own
  // sentence: `readApiJson` reads the 404's envelope and throws the words the route wrote.
  const onOpen = (attachmentId: string): void => {
    const pinned = detail.attachments.find((attachment) => attachment.id === attachmentId);
    if (!pinned) return;

    void (async () => {
      try {
        const response = await api.kanban.attachmentBlob(detail.id, attachmentId);
        // Throws for a refusal; a body that is not JSON at all arrives as the reader's own parse
        // complaint, which is still a sentence rather than silence.
        if (!response.ok) await readApiJson<never>(response);
        downloadBlobAsFile(await response.blob(), pinned.filename);
      } catch (error) {
        toast({
          tone: 'warn',
          title: t('kanban.attachments.openFailed', { defaultValue: 'That file could not be opened' }),
          message: error instanceof Error ? error.message : undefined,
        });
      }
    })();
  };

  const onDismiss = (key: string): void => {
    setUploads((held) => held.filter((row) => row.key !== key));
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {t('kanban.attachments.title', { defaultValue: 'Attachments' })}
        </h3>
        {stored > 0 && (
          <Badge tone="neutral" className="vv-badge--compact">
            {stored}
          </Badge>
        )}
      </div>

      {stored === 0 && uploads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('kanban.attachments.none', { defaultValue: 'Nothing attached yet.' })}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {detail.attachments.map((row) => (
            <AttachmentRow key={row.id} row={row} onOpen={onOpen} onRemove={onRemove} />
          ))}
          {uploads.map((row) => (
            <UploadRowView key={row.key} row={row} onDismiss={onDismiss} />
          ))}
        </ul>
      )}

      {/* The one way in. A dashed frame is the house's word for "drop here" (the file manager
          uses the same one); the button beside it is the same door for a phone, where nothing is
          ever dragged, so the drop words step aside under 640px and the button stays. */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5 text-sm text-muted-foreground',
          dragOver && 'border-primary bg-muted'
        )}
        onDragOver={(event) => {
          event.preventDefault();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(event) => {
          // `dragleave` fires on this frame every time the held file crosses into one of its own
          // children, so the highlight clears only when the pointer has actually left the frame.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          onSelectFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <UploadCloud className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
        <span className="hidden sm:inline">
          {t('kanban.attachments.drop', { defaultValue: 'Drop a file here, or' })}
        </span>
        <Button variant="tonal" size="sm" className="h-7" onClick={() => pickerRef.current?.click()}>
          {t('kanban.attachments.choose', { defaultValue: 'Choose a file' })}
        </Button>
        <input
          ref={pickerRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          aria-label={t('kanban.attachments.choose', { defaultValue: 'Choose a file' })}
          onChange={(event) => {
            // Copied out before the value is cleared: clearing empties the live FileList, and the
            // clear is what lets the same file be picked twice in a row.
            onSelectFiles(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <span className="w-full text-xs text-ink-faint">
          {t('kanban.attachments.limits', { defaultValue: 'PNG, JPEG, GIF, WebP or PDF, up to 8 MB each' })}
        </span>
      </div>
    </section>
  );
}

/** A stored file: its pixels or its glyph, its name and figures, and the press that removes it. */
function AttachmentRow({
  row,
  onOpen,
  onRemove,
}: {
  row: KanbanAttachment;
  onOpen: (attachmentId: string) => void;
  onRemove: (attachmentId: string) => void;
}) {
  const { t } = useTranslation();
  const kind = kindOf(row.mime);
  const Icon = kind.icon;

  // THE PIXELS, AND ONLY FOR AN IMAGE. The row's bytes sit behind the bearer token, so the slot
  // holds an object URL made from a fetched blob and never a `src` pointing at the route — the one
  // shape a bare `<img>` cannot be given. Both the read and the URL die with the row: twenty cards
  // opened in a session would otherwise hold twenty blobs, and twenty object URLs, for the life of
  // the tab. A row whose bytes are gone (a file deleted under the row) keeps its kind glyph.
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!kind.image) return;

    const controller = new AbortController();
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const response = await api.kanban.attachmentBlob(row.cardId, row.id, { signal: controller.signal });
        if (!response.ok) return;
        objectUrl = URL.createObjectURL(await response.blob());
        setPreviewSrc(objectUrl);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.warn('[DrawerAttachments] the preview could not be read:', error);
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [row.cardId, row.id, kind.image]);

  return (
    <RowFrame
      slot={
        kind.image && previewSrc !== null ? (
          <img src={previewSrc} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-5 w-5 text-ink-faint" aria-hidden="true" />
        )
      }
      name={
        // The name is the press that opens the file: a list of names nobody can open is a list.
        <button
          type="button"
          className="truncate text-left text-sm text-foreground hover:underline"
          onClick={() => onOpen(row.id)}
        >
          {row.filename}
        </button>
      }
      meta={`${formatBytes(row.size)} · ${kind.label}`}
      control={
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={t('kanban.attachments.remove', { defaultValue: 'Remove {{name}}', name: row.filename })}
          onClick={() => onRemove(row.id)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      }
    />
  );
}

/** A file in flight or refused. The refusal is the only red on this screen. */
function UploadRowView({ row, onDismiss }: { row: UploadRow; onDismiss: (key: string) => void }) {
  const { t } = useTranslation();
  const failed = row.state === 'failed';

  return (
    <RowFrame
      slot={
        failed ? (
          <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
        ) : (
          <Spinner size={18} />
        )
      }
      name={<span className={cn('truncate text-sm', failed ? 'text-foreground' : 'text-muted-foreground')}>{row.filename}</span>}
      meta={
        row.state === 'failed'
          ? row.reason
          : `${t('kanban.attachments.uploading', { defaultValue: 'Uploading…' })} · ${formatBytes(row.size)}`
      }
      // The refusal WRAPS where every other meta line truncates: on a phone it is the one sentence
      // the reader has to act on, and an ellipsis would cut off the part that says what to do.
      metaClassName={failed ? 'whitespace-normal break-words text-destructive' : undefined}
      control={
        failed ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            aria-label={t('kanban.attachments.dismiss', { defaultValue: 'Dismiss {{name}}', name: row.filename })}
            onClick={() => onDismiss(row.key)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null
      }
    />
  );
}

/** The three columns every row shares: a 40px slot, a name over its figures, and a control. The
 *  figures are not set in tabular figures on purpose: this font's `tnum` widens the decimal point
 *  too, and "61 . 4 KB" is not a number a reader trusts. */
function RowFrame({
  slot,
  name,
  meta,
  metaClassName,
  control,
}: {
  slot: ReactNode;
  name: ReactNode;
  meta: string;
  metaClassName?: string;
  control: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        {slot}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {name}
        <span className={cn('text-xs text-muted-foreground', metaClassName ?? 'truncate')}>{meta}</span>
      </div>
      {control}
    </li>
  );
}
