import { ArrowUpRight, FolderGit2, Pin, PinOff, X } from 'lucide-react';
import { Fragment, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion';
import { useRoadmap } from '@/modules/roadmap';
import { ListBody, NoteBody, PageBody, PlanBody } from '@/modules/station/cardBodies';
import { labelOf } from '@/modules/station/cardLabel';
import { useStation } from '@/modules/station/context/StationContext';
import { useStationSessions } from '@/modules/station/context/StationSessionsContext';
import { StageGone, StageReadFailed } from '@/modules/station/FocusFallback';
import { useKeepFocusWhenGone } from '@/modules/station/hooks/useKeepFocusWhenGone';
import { refusalMessage } from '@/modules/station/stageRefusal';
import { StageHeadActions } from '@/modules/station/stageSlots';
import { docSpacePageUrl } from '@/modules/widgets';
import type { CompanionNote, CompanionNoteRef } from '@/shared/companion-types';
import { COMPANION_NOTE_KIND_GLYPHS, STATION_FOCUS_GLYPHS } from '@/shared/constants';
import { useToast } from '@/shared/context/ToastContext';
import type { StationFocus } from '@/shared/station-types';
import { Button, buttonVariants, Card, DiffLines, Spinner } from '@/shared/ui';
import { cn, formatRelativeTime } from '@/shared/utils';

/** One of her cards on the stage, by its row id. */
type NoteFocus = Extract<StationFocus, { kind: 'note' }>;

/** What a ref's press puts on the stage: a feature's plan card, or a chat. A page opens by its link; a project only shows its path. */
type StagedRef = Extract<CompanionNoteRef, { kind: 'card' | 'chat' }>;

type NoteStageViewProps = {
  focus: NoteFocus;
  /** The card as her picture holds it: undefined until her picture has been read, null once it has and the card is not in it. */
  note: CompanionNote | null | undefined;
  /** Set while her picture has not been read because the read FAILED: the stage says so and offers `onRetry`, in place of waiting. Absent for a read still out. */
  readFailed?: { onRetry: () => void } | null;
  /** The DocSpace link of the page the card is about (`ref.kind === 'page'`); null for a card about anything else. */
  pageHref: string | null;
  /** Pin or Unpin, pressed: `pinned` is what the card becomes. */
  onPin: (pinned: boolean) => void;
  /** Dismiss, pressed: the card taken down, pinned or not (his act). */
  onDismiss: () => void;
  /** The ref's press: the plan card or the chat the card is about, put on the stage. */
  onOpenRef: (ref: StagedRef) => void;
};

/**
 * The card's body, drawn as its kind: her words, a list, a diff, a plan page or a DocSpace page. A diff is the kit's
 * `DiffLines` (the chat's own drawing, its +, − and @@ kept) running edge to edge in a scroller of its own, because a diff's
 * mono lines cannot wrap without lying about the code: the card scrolls them sideways and the page never does.
 */
function NoteKindBody({ note, pageHref }: { note: CompanionNote; pageHref: string | null }) {
  switch (note.kind) {
    case 'note':
      return <NoteBody text={note.text} />;
    case 'list':
      return <ListBody text={note.text} />;
    case 'diff':
      return (
        <div data-station-note-body="diff" data-station-note-scroll="" className="overflow-x-auto overscroll-x-contain">
          <DiffLines text={note.text} />
        </div>
      );
    case 'plan':
      return <PlanBody text={note.text} />;
    case 'page':
      return <PageBody text={note.text} href={pageHref} />;
  }
}

/**
 * A path with a line break offered after each slash (`<wbr />`): the browser offers none there, so a long path broke inside
 * a name ("claudecodeui_ly" | "phe"). It now breaks between names, and `break-words` still cuts a name longer than a line.
 */
function PathWithBreaks({ path }: { path: string }) {
  return path.split(/(?<=\/)/).map((part, index) => (
    <Fragment key={index}>
      {part}
      {part.endsWith('/') && <wbr />}
    </Fragment>
  ));
}

/**
 * The way to what the card is about, under its facts: "Open its plan card" (the feature's card takes the stage), "Open the
 * session" (the chat takes the stage), "Open in DocSpace" (the page in a new tab, a real link), or a project's path in mono,
 * which has nothing to open. Each press names where it goes in words, with the stage's own glyph for the kind it opens.
 */
function NoteRef({ noteRef, pageHref, onOpenRef }: { noteRef: CompanionNoteRef; pageHref: string | null; onOpenRef: (ref: StagedRef) => void }) {
  const { t } = useTranslation();
  switch (noteRef.kind) {
    case 'card':
    case 'chat': {
      const KindIcon = STATION_FOCUS_GLYPHS[noteRef.kind].icon;
      return (
        <Button variant="outline" size="sm" data-station-note-open={noteRef.kind} className="max-md:h-11" onClick={() => onOpenRef(noteRef)}>
          <KindIcon aria-hidden="true" />
          {noteRef.kind === 'card'
            ? t('station.cards.openCard', { defaultValue: 'Open its plan card' })
            : t('station.cards.openChat', { defaultValue: 'Open the session' })}
        </Button>
      );
    }
    case 'page':
      return pageHref === null ? null : (
        <a href={pageHref} target="_blank" rel="noreferrer" data-station-note-open="page" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-md:h-11')}>
          {t('station.cards.openInDocSpace', { defaultValue: 'Open in DocSpace' })}
          <ArrowUpRight aria-hidden="true" />
        </a>
      );
    case 'project':
      return (
        <p data-station-note-project="" className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
          <FolderGit2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="sr-only">{t('station.cards.project', { defaultValue: 'Project' })}</span>
          <code className="min-w-0 break-words font-mono text-foreground">
            <PathWithBreaks path={noteRef.path} />
          </code>
        </p>
      );
  }
}

/**
 * ONE OF HER CARDS ON THE STAGE, drawn as itself ("Cards are large, readable, dismissible, and can be pinned"). The stage's
 * head names it (her card's glyph and word over its title), and the kind's own acts stand in that head (`StageHeadActions`),
 * each naming itself in words beside the stage's ✕, which only clears the stage: Pin, or Unpin on a pinned card, and Dismiss,
 * which takes it down, pinned or not.
 *
 * The body is one card: its facts (the kind as its glyph AND its word, when she put it up, and, pinned, the pin glyph and
 * "Pinned", never the tint alone: MAN-578), the way to what it is about when it is about something (`NoteRef`), then the
 * card's text drawn as its kind (`cardBodies.tsx`), at body size and a reading measure. A long body scrolls under the head.
 *
 * While her picture has not been read, a quiet "Reading her cards…" waits, so a stage restored on a reload never says a card
 * was taken down before it has looked, and a read that failed says so with a Try again (`StageReadFailed`) rather than wait for
 * ever; a card her picture no longer holds says "<title> was taken down" (`StageGone`), and the keyboard that pressed Dismiss
 * stays on that line instead of falling to the page's top.
 *
 * THE TOUCH LAW. Pin, Dismiss and the ref's press are 44 px catches under a finger below 768 px, and say what they do in
 * words. `data-station-note` reads the card's id, or `reading`, `failed` or `gone`. A pure view: `NoteStage` below binds it, and
 * `.verify/kaylee-station-shots.mjs` draws it on `fake/cards.ts`'s cards.
 */
export function NoteStageView({ focus, note, readFailed = null, pageHref, onPin, onDismiss, onOpenRef }: NoteStageViewProps) {
  const { t } = useTranslation();
  // The gone line's box, which takes the keyboard when a card leaves while Dismiss had it (`useKeepFocusWhenGone`).
  const goneRef = useRef<HTMLDivElement>(null);
  useKeepFocusWhenGone(note !== undefined && note !== null, goneRef);

  if (note === undefined) {
    if (readFailed !== null) {
      return (
        <div data-station-note="failed">
          <StageReadFailed kind="note" title={t('station.cards.readFailed', { defaultValue: 'Her cards could not be read just now.' })} onRetry={readFailed.onRetry} />
        </div>
      );
    }
    return (
      <div data-station-note="reading" className="grid place-items-center py-10">
        <Spinner size={32} label={t('station.cards.reading', { defaultValue: 'Reading her cards…' })} />
      </div>
    );
  }
  if (note === null) {
    return (
      <div ref={goneRef} tabIndex={-1} data-station-note="gone" className="outline-none">
        <StageGone focus={focus} />
      </div>
    );
  }

  const glyph = COMPANION_NOTE_KIND_GLYPHS[note.kind];
  const KindIcon = glyph.icon;
  return (
    <article data-station-note={note.id} data-station-note-kind={note.kind} data-station-note-pinned={note.pinned} className="min-w-0">
      <StageHeadActions>
        <Button variant="outline" size="sm" data-station-note-pin={note.pinned ? 'unpin' : 'pin'} className="max-md:h-11" onClick={() => onPin(!note.pinned)}>
          {note.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          {note.pinned ? t('station.cards.unpin', { defaultValue: 'Unpin' }) : t('station.cards.pin', { defaultValue: 'Pin' })}
        </Button>
        <Button variant="outline" size="sm" data-station-note-dismiss="" className="max-md:h-11" onClick={onDismiss}>
          <X aria-hidden="true" />
          {t('station.cards.dismiss', { defaultValue: 'Dismiss' })}
        </Button>
      </StageHeadActions>
      <Card className="flex min-w-0 flex-col overflow-hidden">
        <div className="flex min-w-0 flex-col gap-3 border-b border-border px-4 py-3 lg:px-5">
          <p data-station-note-facts="" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <KindIcon aria-hidden="true" className="size-4 shrink-0" />
              {t(glyph.wordKey)}
            </span>
            <span aria-hidden="true">{'·'}</span>
            <time dateTime={note.at}>{t('station.cards.putUp', { when: formatRelativeTime(note.at), defaultValue: 'put up {{when}}' })}</time>
            {note.pinned && (
              <>
                <span aria-hidden="true">{'·'}</span>
                <span data-station-note-pinned-word="" className="inline-flex items-center gap-1 font-medium text-accent-ink">
                  <Pin aria-hidden="true" className="size-3.5 shrink-0 fill-current" />
                  {t('station.cards.pinned', { defaultValue: 'Pinned' })}
                </span>
              </>
            )}
          </p>
          {note.ref !== null && (
            <div data-station-note-ref={note.ref.kind} className="flex min-w-0">
              <NoteRef noteRef={note.ref} pageHref={pageHref} onOpenRef={onOpenRef} />
            </div>
          )}
        </div>
        <div className={cn('min-w-0', note.kind === 'diff' ? 'py-2' : 'p-4 lg:p-5')}>
          <NoteKindBody note={note} pageHref={pageHref} />
        </div>
      </Card>
    </article>
  );
}

/**
 * Her card's stage on the page, registered for the `note` kind in `stageViews.ts`, drawn by `StationStage`: it finds the card
 * in her picture by the focus's id and binds his pin, his dismissal and the ref's press, and hands them to `NoteStageView`,
 * which draws every state.
 *
 * Pin and Dismiss are his acts on the server's store, and the stage waits for their frames (`companion_note_pinned`,
 * `companion_note_removed`) to redraw, as her panel does; a refusal is a warn toast with the server's own sentence. A ref's
 * press stages the thing the card is about, named as the station already names it: a plan card by the roadmap's title of the
 * plan, a chat by his sessions' name for it, and the focus the card replaces goes one Back away.
 */
export function NoteStage({ focus }: { focus: NoteFocus }) {
  const { t } = useTranslation();
  const pushToast = useToast();
  const { picture, readFailure, reread, pinNote, dismissNote } = useCompanion();
  const { setFocus } = useStation();
  const { sessions } = useStationSessions();
  const { picture: roadmap } = useRoadmap();

  // undefined while her picture has not been read (the view waits); null once it has and the card is not in it (taken down).
  const note = picture === null ? undefined : (picture.notes.find((card) => card.id === focus.id) ?? null);
  const pageHref = note?.ref?.kind === 'page' ? docSpacePageUrl(note.ref.pageId, note.ref.blockId) : null;

  const refuse = (title: string, error: unknown) => pushToast({ tone: 'warn', title, message: refusalMessage(error) });

  return (
    <NoteStageView
      focus={focus}
      note={note}
      // Her picture is null and its read failed: the stage says so with a Try again (`reread`) instead of waiting on it.
      readFailed={picture === null && readFailure !== null ? { onRetry: reread } : null}
      pageHref={pageHref}
      onPin={(pinned) => {
        pinNote(focus.id, pinned).catch((error: unknown) => {
          refuse(
            pinned
              ? t('station.cards.pinRefused', { title: focus.label, defaultValue: 'Could not pin {{title}}' })
              : t('station.cards.unpinRefused', { title: focus.label, defaultValue: 'Could not unpin {{title}}' }),
            error,
          );
        });
      }}
      onDismiss={() => {
        dismissNote(focus.id).catch((error: unknown) => {
          refuse(t('station.cards.dismissRefused', { title: focus.label, defaultValue: 'Could not dismiss {{title}}' }), error);
        });
      }}
      onOpenRef={(ref) => {
        if (ref.kind === 'card') setFocus({ kind: 'card', plan: ref.plan, label: labelOf(roadmap, ref.plan) });
        else setFocus({ kind: 'chat', sessionId: ref.sessionId, label: sessions?.find((session) => session.sessionId === ref.sessionId)?.name || ref.sessionId });
      }}
    />
  );
}
