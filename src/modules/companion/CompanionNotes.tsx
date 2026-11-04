import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessage } from '@/shared/api';
import type { CompanionNote } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';
import { Button, Card, CardFoldBody, CardFoldToggle, Collapsible } from '@/shared/ui';

type CompanionNotesProps = {
  notes: CompanionNote[];
  /** Her name, for the group's accessible name. */
  name: string;
  /** Whether he keeps them folded to their count line (the panel's `useNotesFold`). */
  folded: boolean;
  /** His press on the count line's fold control. */
  onFoldChange: (folded: boolean) => void;
  /** The ids of the notes that arrived while they were folded: the folded line marks them new until he opens it. */
  fresh: ReadonlySet<number>;
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
 *
 * THE COUNT LINE stands over them whenever there is one — "3 notes", sticky as they scroll — with the section's one fold
 * control at its end (the kit's `CardFoldToggle`, its chevron the house's `FoldChevron`). Squeezed to the panel's floor
 * for them, the line and the first title with its ✕ still say what is there, so a note never disappears without a trace.
 * FOLDED (his press, kept in this browser), the section is that one line: the cards stay mounted in the kit's
 * `CardFoldBody`, which clips them to nothing and takes them out of the tab order and the accessibility tree, and the
 * dock's other cards take the room. A note that arrives while they are folded moves the count and is marked on the line —
 * "1 new", in her accent, popping in once (`animate-mark-in`, none under `prefers-reduced-motion`) — and the notes stay
 * folded: the mark stays until he opens them. Dismissing the last note takes the section away, the fold kept for the next.
 *
 * A dismissal is gone at once: the card hides as it is pressed and stays hidden once the press lands, until the note
 * leaves her picture. It comes back only when the press is refused, and a toast says why.
 *
 * Used by this module's CompanionPanel, in the dock between the walkthrough and the draft.
 */
export function CompanionNotes({ notes, name, folded, onFoldChange, fresh, onDismiss }: CompanionNotesProps) {
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
  const freshCount = folded ? shown.filter((note) => fresh.has(note.id)).length : 0;
  // The mark is keyed by the newest note it counts, so each arrival pops it in again and nothing else does.
  const newestFresh = freshCount > 0 ? Math.max(...shown.filter((note) => fresh.has(note.id)).map((note) => note.id)) : null;

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
    <section aria-label={t('companion.notes.label', { name })} data-companion-notes={folded ? 'folded' : 'open'}>
      <Collapsible open={!folded} onOpenChange={(open) => onFoldChange(!open)} className="flex flex-col">
        <div data-companion-notes-count="" className="sticky top-0 z-10 flex items-center gap-2 bg-background">
          <p className="flex min-w-0 flex-1 items-center gap-2 text-xs uppercase leading-4 tracking-[0.14em] text-ink-faint">
            <span>{t('companion.notes.count', { count: shown.length })}</span>
            {newestFresh !== null && (
              <span key={newestFresh} data-companion-notes-new="" className="rounded-full bg-accent-soft px-1.5 font-medium text-accent-ink motion-safe:animate-mark-in">
                {t('companion.notes.new', { count: freshCount })}
              </span>
            )}
          </p>
          {/* Its chevron in line with the cards' ✕ below it (their 6px inset and their border). */}
          <CardFoldToggle className="mr-[7px]" />
        </div>
        {/* Out to the scroller's own inset and back in, so the clip the fold draws keeps the cards' edges and shadows. */}
        <CardFoldBody className="-mx-3">
          <div className="flex flex-col gap-2 px-3 pb-1 pt-2">
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
          </div>
        </CardFoldBody>
      </Collapsible>
    </section>
  );
}
