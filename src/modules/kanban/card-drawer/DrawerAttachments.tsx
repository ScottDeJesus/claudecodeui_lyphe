import { File as FileIcon, FileImage, FileText, Plus, X } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { KanbanMutations } from '@/modules/kanban/hooks/useKanbanMutations';
import { api, readApiJson } from '@/shared/api';
import { useToast } from '@/shared/context/ToastContext';
import type { KanbanAttachment, KanbanCardDetail } from '@/shared/kanban-types';
import { Button, Rule, Spinner } from '@/shared/ui';
import { downloadBlobAsFile, formatBytes } from '@/shared/utils';

/**
 * WHAT IS PINNED TO THE CARD: the files a person or a build left on it, and the one place to add
 * another.
 *
 * ON EVERY CARD, WHATEVER AUTONOMY SAYS. Attachments are the operator's own — a screenshot of the
 * bug, the PDF the customer sent — and belong to the card the way its title does. The three
 * sections autonomy hides are the RUN's ledger; this one is the card's, so the shell mounts it
 * beside the body and never inside the gated block.
 *
 * ONE CHIP, THREE STATES (the design system's Files). A stored file, a file on its way up and a file the server refused are
 * each a chip on one hairline: a slot, the name, its size, and the × that takes it off. What changes between them is the slot
 * and the tone: a stored picture shows its own pixels, a file in flight shows the house ring, a refusal shows the danger
 * glyph and says so under its name. Red is spent on the refusal alone, because it is the only thing here that asks to be
 * acted on.
 *
 * ONE PRESS IN, AND THE WHOLE CARD TO DROP ON. The plus at the end of the section's Rule picks files (its title says what the
 * server takes); a file dropped anywhere on the open card lands here too, through `add` (the shell's drop, `KanbanCardDrawer`).
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

/** What the shell can ask of this section: take these files, as a pick or a drop would. */
export type DrawerAttachmentsHandle = { add: (files: File[]) => void };

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

/** Rendered by KanbanCardDrawer on every card, beside DrawerBody; the shell holds its handle for a drop. Nothing else mounts it. */
export const DrawerAttachments = forwardRef<DrawerAttachmentsHandle, DrawerAttachmentsProps>(function DrawerAttachments({ detail, writes }, ref) {
  const { t } = useTranslation();
  const toast = useToast();
  const headingId = useId();
  const pickerRef = useRef<HTMLInputElement>(null);

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

  const onSelectFiles = useCallback(
    (files: File[]): void => {
      for (const file of files) void uploadOne(file);
    },
    [uploadOne]
  );
  useImperativeHandle(ref, () => ({ add: onSelectFiles }), [onSelectFiles]);

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

  const choose = t('kanban.attachments.choose', { defaultValue: 'Choose a file' });
  const limits = t('kanban.attachments.limits', { defaultValue: 'PNG, JPEG, GIF, WebP or PDF, up to 8 MB each' });

  return (
    <section className="flex flex-col gap-2" aria-labelledby={headingId} data-drawer-attachments="">
      <Rule
        id={headingId}
        end={
          <>
            {stored > 0 && <span aria-hidden="true">{stored}</span>}
            <Button variant="outline" size="icon" className="size-7 finger:size-11" aria-label={choose} title={`${choose} · ${limits}`} onClick={() => pickerRef.current?.click()}>
              <Plus aria-hidden="true" />
            </Button>
          </>
        }
      >
        {t('kanban.attachments.title', { defaultValue: 'Attachments' })}
      </Rule>
      <input
        ref={pickerRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          // Copied out before the value is cleared: clearing empties the live FileList, and the clear is what lets the same
          // file be picked twice in a row.
          onSelectFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />

      {(stored > 0 || uploads.length > 0) && (
        <ul className="ast-files">
          {detail.attachments.map((row) => (
            <AttachmentChip key={row.id} row={row} onOpen={onOpen} onRemove={onRemove} />
          ))}
          {uploads.map((row) => (
            <UploadChip key={row.key} row={row} onDismiss={onDismiss} />
          ))}
        </ul>
      )}
    </section>
  );
});

/** A stored file: its pixels or its glyph, its name (the press that opens it), its size, and the × that takes it off. */
function AttachmentChip({
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

  const remove = t('kanban.attachments.remove', { defaultValue: 'Remove {{name}}', name: row.filename });
  return (
    <li className="ast-file-chip" data-attachment={row.id}>
      <span className="ast-file-thumb">
        {kind.image && previewSrc !== null ? <img src={previewSrc} alt="" /> : <Icon className="size-4" aria-hidden="true" />}
      </span>
      {/* The name is the press that opens the file: a list of names nobody can open is a list. */}
      <button type="button" className="ast-file-name" title={`${row.filename} · ${kind.label}`} onClick={() => onOpen(row.id)}>
        {row.filename}
      </button>
      <span className="ast-file-size">{formatBytes(row.size)}</span>
      <button type="button" className="ast-file-x" aria-label={remove} title={remove} onClick={() => onRemove(row.id)}>
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </li>
  );
}

/** A file in flight or refused. The refusal is the only red on this card, and it says so under the file's name. */
function UploadChip({ row, onDismiss }: { row: UploadRow; onDismiss: (key: string) => void }) {
  const { t } = useTranslation();
  const failed = row.state === 'failed';
  const dismiss = t('kanban.attachments.dismiss', { defaultValue: 'Dismiss {{name}}', name: row.filename });

  return (
    <li className="ast-file-chip" data-state={row.state}>
      <span className="ast-file-thumb">
        {failed ? <span className="bug-glyph" data-tone="danger" aria-hidden="true">✕</span> : <Spinner size={14} />}
      </span>
      <span className="ast-file-name">{row.filename}</span>
      <span className="ast-file-size">
        {failed ? null : `${t('kanban.attachments.uploading', { defaultValue: 'Uploading…' })} · ${formatBytes(row.size)}`}
      </span>
      {failed && (
        <button type="button" className="ast-file-x" aria-label={dismiss} title={dismiss} onClick={() => onDismiss(row.key)}>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
      {/* The refusal wraps where a name truncates: it is the one sentence the reader has to act on. */}
      {row.state === 'failed' && <p className="ast-file-said">{row.reason}</p>}
    </li>
  );
}
