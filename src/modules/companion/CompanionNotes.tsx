import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/shared/api';
import type { CompanionNote } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';
import { Button, Card } from '@/shared/ui';

type CompanionNotesProps = {
  notes: CompanionNote[];
  /** Her name, for the group's accessible name. */
  name: string;
  onDismiss: (id: number) => Promise<void>;
};

/** A line that opens a list: `- `, `* `, `• `, `1. ` or `1) `. */
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/m;
/** A path: `/abs/…`, `~/…`, `./…`, `../…`, a Windows drive, or a relative `dir/file.ext`. */
const PATH = /(?:^|[\s(`'"])(?:~|\.{1,2})?\/[^\s/]+|[A-Za-z]:\\|[\w.-]+\/[\w.-]+\.\w{1,8}\b/;

/** Whether a note holds a list or a path, which are read by their shape: those keep her line breaks in monospace. */
const isPreformatted = (text: string): boolean => LIST_LINE.test(text) || PATH.test(text);

/**
 * The cards she put on the panel with `show_note` instead of saying them: a list, a path, a set of numbers — things better
 * seen than heard. Each card is its title and its text, and a ✕ that dismisses it; it stays until he does, or until she
 * takes it down herself (`dismiss_note`, which arrives as the same `companion_note_removed`). A note that
 * holds a list or a path keeps her lines exactly, in monospace (a long path breaks where it must rather than running off the card);
 * any other note is prose with her line breaks kept. The panel scrolls the notes as one, between the walkthrough and the
 * draft, so a long note never pushes the draft or the composer off the panel and never nests a scroller in a scroller.
 * With two or more, a count stands over them ("2 notes"), sticky as they scroll: squeezed to the panel's floor for them,
 * the count and the first title with its ✕ still say what is there, so a note never disappears without a trace.
 *
 * A dismissal is gone at once: the card hides as it is pressed and stays hidden once the press lands, until the note
 * leaves her picture. It comes back only when the press is refused, and a toast says why.
 *
 * Used by this module's CompanionPanel, in the dock between the walkthrough and the draft.
 */
export function CompanionNotes({ notes, name, onDismiss }: CompanionNotesProps) {
  const { t } = useTranslation();
  const pushToast = useToast();
  // The notes he dismissed that are still in her picture, hidden at once so a press needs no waiting. An id stays until
  // its note leaves the picture (a 204 can land before the frame that removes it), and goes back only on a refusal.
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(() => new Set());

  // A dismissed note that has left her picture is done leaving. Dropped while rendering, which React re-runs at once.
  const present = new Set(notes.map((note) => note.id));
  if ([...leaving].some((id) => !present.has(id))) setLeaving(new Set([...leaving].filter((id) => present.has(id))));

  const shown = notes.filter((note) => !leaving.has(note.id));
  if (shown.length === 0) return null;

  const dismiss = (note: CompanionNote) => {
    setLeaving((was) => new Set(was).add(note.id));
    onDismiss(note.id).catch((error: unknown) => {
      setLeaving((was) => {
        const next = new Set(was);
        next.delete(note.id);
        return next;
      });
      pushToast({ tone: 'warn', title: t('companion.notes.dismissRefused', { title: note.title }), message: errorMessage(error) ?? undefined });
    });
  };

  return (
    <section aria-label={t('companion.notes.label', { name })} data-companion-notes="" className="flex flex-col gap-2">
      {shown.length > 1 && (
        <p data-companion-notes-count="" className="sticky top-0 z-10 bg-background text-xs uppercase leading-4 tracking-[0.14em] text-ink-faint">
          {t('companion.notes.count', { count: shown.length })}
        </p>
      )}
      {shown.map((note) => (
        <Card key={note.id} data-companion-note={note.id} className="flex flex-col gap-1 py-2 pl-3 pr-1.5">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 break-words pt-1 text-sm font-semibold leading-snug text-foreground">{note.title}</h3>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('companion.notes.dismiss', { title: note.title })}
              // 28px to look at, a 40px catch under a mouse and 44px under a finger (Verve's touch floor).
              className="relative h-7 w-7 shrink-0 text-muted-foreground before:absolute before:-inset-1.5 before:content-[''] hover:text-foreground [@media(pointer:coarse)]:before:-inset-2"
              onClick={() => dismiss(note)}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
          {isPreformatted(note.text) ? (
            <pre className="whitespace-pre-wrap break-words pr-1.5 font-mono text-xs leading-relaxed text-foreground">{note.text}</pre>
          ) : (
            <p className="whitespace-pre-line break-words pr-1.5 text-sm leading-relaxed text-foreground">{note.text}</p>
          )}
        </Card>
      ))}
    </section>
  );
}
