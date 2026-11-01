import { MessageSquarePlus, Send } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useCardFloor } from '@/modules/companion/hooks/useCardFloor';
import { useFieldRoom } from '@/modules/companion/hooks/useFieldRoom';
import { useGrowingField } from '@/modules/companion/hooks/useGrowingField';
import { errorMessage } from '@/shared/api';
import type { CompanionDraft } from '@/shared/companion-types';
import { useToast } from '@/shared/context/ToastContext';
import { Button, Card, ConfirmDialog, TextArea, Tooltip } from '@/shared/ui';
import { cn, formatRelativeTime } from '@/shared/utils';

type SendMode = 'turn' | 'steer';

type CompanionDraftCardProps = {
  draft: CompanionDraft;
  /** Her name, for the words that say she changed the draft. */
  name: string;
  /** Whether the target chat is working right now. Only then is there a turn to steer: Send steer shows, and leads. */
  targetWorking: boolean;
  /** Whether her panel is drawn: the field is measured only then, and again when it opens. */
  visible: boolean;
  onEdit: (text: string) => Promise<void>;
  /** Sends the draft as it stands. A refused send rejects with the server's sentence, which the card shows. */
  onSend: (mode: SendMode) => Promise<void>;
  onClear: () => Promise<void>;
  /** The station's press on the target's name, which puts the session on its stage; absent, the name is text (her panel). */
  onTargetPress?: () => void;
  /**
   * The station's dock passes it, and only the dock: the card draws its HEAD LINE — the target with Steer's state, and the sends
   * with Clear — as one row at its head (the sends wrapping under the target where the width is short), a refused send's sentence
   * under it, and the field under all of it, giving way down to nothing. Absent (her panel), the card draws as it always has.
   */
  headLine?: boolean;
};

/** The house's eyebrow (MAN-742): it names the card, and states nothing on its own. */
const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

/**
 * THE DRAFT: the one thing ever sent to a chat, so its target and its words are always on screen and his to edit.
 * Drawn in two homes, each the one editor of the one draft: this module's CompanionPanel, last in her dock right above the
 * composer, and the station module's dock (`StationDock`), at the foot of her column over the talk control, which also hands
 * `onTargetPress`.
 *
 * TOP: "DRAFT" and the target — "For Kanban lanes · claudecodeui_lyphe", or "New chat in claudecodeui_lyphe" — where the
 * chat's name keeps its room and the project gives way first; under it "Working now" while that chat runs a turn, and when
 * she last changed the draft. Given `onTargetPress` (the station), a chat's name is a link-styled press named "Show Kanban
 * lanes on the stage", a 44px catch under a finger (a touch screen, or a window under 768px: the touch law, INV-10275); a new
 * chat has no session to show, so its target stays words, as the panel's always does. BODY: the words, in a field he can edit
 * that grows with them into whatever room the dock leaves — the notes give way first, down to their floor — and scrolls
 * inside past that, never below its 88px floor, so a brief built over a walkthrough is read as whole as the screen allows.
 * Only the field gives way inside the card: the
 * target, the notice and the sends always stand. FOOT: the sends and Clear. While the target is working, Send steer leads
 * (it folds the brief into the turn running now) and Send turn follows; otherwise Send turn stands alone. Where nothing
 * hovers (a touch screen, `hover: none`) what Send steer does also stands in words under the sends, muted and led by its
 * name ("Send steer · Folds it into the turn running now"); a pointer keeps its tooltip and is drawn no words. Clear asks
 * first: a brief built over a walkthrough is work.
 *
 * THE HEAD LINE (`headLine`, the station's dock alone): the same pieces in another order, so what his act needs stands first in
 * a column that runs short. One row at the head holds "DRAFT", the target and "Working now", then the sends and Clear, which wrap
 * under the target where the row is too short for both; Send steer's words and a refusal stand under that row, then her
 * rewrite's notice, then the field, alone in a box that clips it, so it gives way down to nothing (below its first line it steps
 * aside whole, `useFieldRoom`, never a sliver, and never while it holds the focus) and the floor the card measures is the head
 * line alone. The project and when she changed the brief stand in the head line only in the room the chat's name leaves them,
 * each whole or not at all, the stamp giving way first: the record yields before the brief, which is his act. A press on the
 * head line's words opens the brief (the field
 * takes the focus, and the dock gives it its room back), so a pointer reaches a field that has given way.
 *
 * HIS EDIT IS HELD HERE, so typing never waits on the server. It is saved when the field loses focus, and BEFORE A SEND,
 * so what is sent is exactly what he sees. While he has no edit the field shows her draft and follows her rewrites as
 * they land; a rewrite that lands under an unsaved edit is said ("Kaylee changed the draft while you were editing")
 * with Use hers, never silently kept or dropped — and his own save coming back while he types on is his, never hers.
 * A refused send or save leaves everything on screen and says why.
 */
export function CompanionDraftCard({ draft, name, targetWorking, visible, onEdit, onSend, onClear, onTargetPress, headLine = false }: CompanionDraftCardProps) {
  const { t } = useTranslation();
  const pushToast = useToast();
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // The head line's box round the field, which clips it as it gives way to nothing: the floor counts it at nothing.
  const fieldBoxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // His edit while it differs from the draft: unsaved, or saving. Null when the field simply shows her draft.
  const [edit, setEdit] = useState<string | null>(null);
  // The draft text his edit started from: a draft that moves off it (and not onto his own words) is her rewrite.
  const [editBase, setEditBase] = useState('');
  // The words his latest save carried, AS THE SERVER STORES THEM (trimmed: `PUT /draft` keeps no leading or trailing blank).
  // A draft that arrives equal to them is his own save's echo — he may have typed on since — so it becomes the edit's new
  // base instead of reading as her rewrite; an edit ending in a space or a newline would otherwise never match its echo.
  const [ownSave, setOwnSave] = useState<string | null>(null);
  // The send that is out, so its button is busy and neither can be pressed twice; null when none is.
  const [sending, setSending] = useState<SendMode | null>(null);
  // The last refusal of a send or a save, in the server's words, shown under the sends until the next press.
  const [refusal, setRefusal] = useState<string | null>(null);
  // Whether Clear's question is up.
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Clear's answer is out.
  const [clearing, setClearing] = useState(false);
  // The save in flight and the words it carries, so a send pressed while a blur's save is out waits on that save rather
  // than sending the same words twice.
  const savingRef = useRef<{ words: string; done: Promise<void> } | null>(null);
  // The words his last save carried home: a send pressed after that save settled, before the draft echoes it back, has
  // nothing left to save.
  const savedRef = useRef<string | null>(null);

  // His save came back (or she wrote the very same words): the edit has nothing left to hold. Set while rendering, which
  // React re-runs at once, so a field that agrees with the draft never draws as an unsaved edit.
  if (edit !== null && edit === draft.text) setEdit(null);
  // His save's echo under words he has typed since: it is his, and the base his edit now stands on.
  if (edit !== null && ownSave !== null && draft.text === ownSave && editBase !== ownSave) setEditBase(ownSave);

  // The field starts at its words' height and gives way to the dock's room (a flex basis, not a height), measured while drawn.
  useGrowingField(fieldRef, edit ?? draft.text, visible, 'flexBasis');

  // The card's own floor (all of it but the field, plus the field's 88px; in the head line, the field's box at nothing), so the
  // dock scrolls it whole, never folds it.
  useCardFloor(cardRef, headLine ? fieldBoxRef : fieldRef, visible);
  // In the head line, the field steps aside whole while it would show less than one line.
  useFieldRoom(fieldBoxRef, fieldRef, headLine && visible);

  const shown = edit ?? draft.text;
  const theirsChanged = edit !== null && draft.text !== editBase && draft.text !== edit;
  const empty = shown.trim().length === 0;
  // Only a working chat has a turn to steer: Send steer is offered, and leads, only then.
  const steerOffered = targetWorking && draft.target.kind === 'session';
  const target = draft.target.kind === 'session'
    ? t('companion.draft.forChat', { chat: draft.target.session.name })
    : t('companion.draft.newChat', { project: draft.target.projectName });
  // The same target inside a sentence: "for Kanban lanes", "for a new chat in claudecodeui_lyphe".
  const about = draft.target.kind === 'session'
    ? t('companion.draft.aboutChat', { chat: draft.target.session.name })
    : t('companion.draft.aboutNew', { project: draft.target.projectName });

  const type = (value: string) => {
    // A new edit starts from the draft as it stands now, with nothing of an earlier edit counted as saved.
    if (edit === null) {
      setEditBase(draft.text);
      setOwnSave(null);
      savedRef.current = null;
    }
    setEdit(value);
  };

  /** Saves his edit if there is one to save; resolves once the words on screen are the draft's. */
  const save = (): Promise<void> => {
    if (edit === null || edit === draft.text || edit === savedRef.current) return Promise.resolve();
    if (savingRef.current?.words === edit) return savingRef.current.done;
    const words = edit;
    setOwnSave(words.trim());
    const done = onEdit(words)
      .then(() => { savedRef.current = words; })
      .finally(() => {
        if (savingRef.current?.words === words) savingRef.current = null;
      });
    savingRef.current = { words, done };
    return done;
  };

  /** The refusal line: the server's sentence after the card's own words, or the card's words alone when it sent none. */
  const refuse = (what: 'save' | 'send', error: unknown) => {
    const reason = errorMessage(error);
    setRefusal(reason === null ? t(`companion.draft.${what}RefusedPlain`) : t(`companion.draft.${what}Refused`, { reason }));
  };

  const saveOnLeave = () => {
    setRefusal(null);
    save().catch((error: unknown) => refuse('save', error));
  };

  const send = (mode: SendMode) => {
    setRefusal(null);
    setSending(mode);
    save()
      .then(() => onSend(mode))
      .catch((error: unknown) => refuse('send', error))
      .finally(() => setSending(null));
  };

  const clear = () => {
    setClearing(true);
    onClear()
      .then(() => {
        setConfirmingClear(false);
        setEdit(null);
      })
      .catch((error: unknown) => pushToast({ tone: 'warn', title: t('companion.draft.clearRefused'), message: errorMessage(error) ?? undefined }))
      .finally(() => setClearing(false));
  };

  const sendButton = (mode: SendMode, lead: boolean) => {
    const button = (
      <Button
        key={mode}
        variant={lead ? 'default' : 'outline'}
        size="sm"
        busy={sending === mode}
        disabled={empty || (sending !== null && sending !== mode)}
        onClick={() => send(mode)}
        data-companion-send={mode}
        className="finger:h-11"
      >
        {lead && <Send aria-hidden="true" />}
        {t(mode === 'steer' ? 'companion.draft.sendSteer' : 'companion.draft.sendTurn')}
      </Button>
    );
    return mode === 'steer' ? <Tooltip key={mode} content={t('companion.draft.steerHint')} position="top">{button}</Tooltip> : button;
  };

  // When she last changed the draft: under the target in her panel, in the head line's trail in the dock.
  const updated = t('companion.draft.updated', { when: formatRelativeTime(draft.updatedAt) });
  // "DRAFT" and the target: the chat's name keeps its room and the project gives way first.
  const targetWords = (
    <>
      <span className={cn(EYEBROW, 'shrink-0')}>{t('companion.draft.title')}</span>
      {draft.target.kind === 'new' && <MessageSquarePlus aria-hidden="true" className="size-3.5 shrink-0 self-center text-muted-foreground" />}
      {draft.target.kind === 'session' && onTargetPress !== undefined ? (
        // "For" stays words and the chat's name is the press, so its name ("Show Kanban lanes on the stage") holds the
        // words on screen, in the accent's readable ink (the fill's green is under 4.5:1 on light). This span does not
        // clip: the catch (`::before`) reaches past the line, under a finger up into the card's padding and never down
        // over the passive line under it; in the head line, whose row is the sends' 44 px, it reaches 12 px each way and
        // stays inside the row. The name truncates inside.
        <span data-companion-draft-target="" className="flex min-w-0 items-baseline gap-1 font-medium text-foreground">
          <Trans
            t={t}
            i18nKey="companion.draft.forChatPress"
            // The name rides as the slot's own child, so a name holding "<" reads as written.
            components={{
              chat: (
                <Button
                  variant="link"
                  size="sm"
                  aria-label={t('companion.draft.showOnStage', { chat: draft.target.session.name })}
                  onClick={onTargetPress}
                  data-companion-draft-target-press=""
                  className={cn(
                    "relative h-auto min-w-0 justify-start px-0 py-0 text-sm font-medium text-accent-ink before:absolute before:-inset-x-1 before:-inset-y-1 before:content-['']",
                    headLine ? 'finger:before:-inset-y-3' : 'finger:before:-top-7 finger:before:bottom-0',
                  )}
                >
                  <span className="min-w-0 truncate">{draft.target.session.name}</span>
                </Button>
              ),
            }}
          />
        </span>
      ) : (
        <span data-companion-draft-target="" className="min-w-0 truncate font-medium text-foreground">{target}</span>
      )}
      {/* The chat he knows is named before the project it lives in: the project shrinks four times as fast as the name. In the
          head line the project, then when she changed the brief, take only the room the name leaves, each whole or not at all:
          their slot grows from nothing, and after a zero-width first item each wraps out of the slot's one clipped line where it
          does not fit, the stamp first (no press inside, so no catch is clipped). */}
      {headLine ? (
        <span data-companion-draft-trail="" className="flex h-4 min-w-0 flex-[1_1_0] flex-wrap items-baseline gap-x-1 overflow-hidden text-xs text-muted-foreground">
          <span aria-hidden="true">{'​'}</span>
          {draft.target.kind === 'session' && <span className="whitespace-nowrap">· {draft.target.session.project}</span>}
          <span className="whitespace-nowrap">· {updated}</span>
        </span>
      ) : draft.target.kind === 'session' && (
        <span className="min-w-0 shrink-[4] truncate text-xs text-muted-foreground">· {draft.target.session.project}</span>
      )}
    </>
  );
  // Steer's state while the target works (a turn runs, so Send steer leads), and when she last changed the draft.
  const working = steerOffered && (
    <span data-tone="info" className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-tone-ink">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-tone-dot motion-safe:animate-pulse" />
      {t('companion.draft.working')}
    </span>
  );
  const stamp = <span className="min-w-0 truncate">{updated}</span>;
  const field = (
    <>
      <label htmlFor={fieldId} className="sr-only">{t('companion.draft.fieldLabel', { about })}</label>
      <TextArea
        ref={fieldRef}
        id={fieldId}
        rows={3}
        value={shown}
        onChange={(event) => type(event.target.value)}
        onBlur={saveOnLeave}
        // In the head line the kit's 88px floor is let go (its two classes, matched): the field gives way to nothing.
        className={cn('overflow-y-auto', headLine && 'mt-2 [&.vv-textarea]:min-h-0')}
      />
    </>
  );
  const notice = theirsChanged && (
    <p data-tone="info" className="flex shrink-0 flex-wrap items-center gap-x-2 text-xs text-tone-ink">
      {t('companion.draft.theirsChanged', { name })}
      <Button variant="link" size="sm" className="h-auto px-0 py-0 text-xs" onClick={() => setEdit(null)}>
        {t('companion.draft.useTheirs', { name })}
      </Button>
    </p>
  );
  const sends = (
    <>
      {/* Send turn and Send steer both send through `onSend`, which the panel's shell binds to the send verb. */}
      {steerOffered ? [sendButton('steer', true), sendButton('turn', false)] : sendButton('turn', true)}
      <Button
        variant="ghost"
        size="sm"
        disabled={sending !== null}
        // The panel holds two Clears: this one discards the brief, the header's wipes her conversation. `ml-auto`, not a
        // spacer before it: when the row wraps on a narrow phone, Clear stands at the right end of its own line, apart
        // from the sends, never under the lead one.
        aria-label={t('companion.draft.clearLabel')}
        onClick={() => setConfirmingClear(true)}
        className="ml-auto text-muted-foreground hover:text-foreground finger:h-11"
      >
        {t('companion.draft.clear')}
      </Button>
    </>
  );
  const steerWords = steerOffered && (
    // What Send steer does, in words where nothing hovers to open its tooltip (a touch screen): muted, under the sends, led
    // by its name so it is never read as Send turn's. A pointer keeps the tooltip and draws no words.
    <p data-companion-steer-words="" className="hidden shrink-0 text-xs leading-snug text-muted-foreground [@media(hover:none)]:block">
      <span className="font-medium text-foreground">{t('companion.draft.sendSteer')}</span>
      {' · '}
      {t('companion.draft.steerHint')}
    </p>
  );
  const refusalLine = refusal !== null && (
    <p role="alert" data-tone="warn" className="flex shrink-0 items-start gap-1.5 text-xs leading-relaxed text-tone-ink">
      <span aria-hidden="true">▲</span>
      {refusal}
    </p>
  );
  const clearQuestion = (
    <ConfirmDialog
      open={confirmingClear}
      title={t('companion.draft.clearTitle')}
      message={t('companion.draft.clearMessage', { about, name })}
      actions={[
        { label: t('companion.cancel'), variant: 'outline', onSelect: () => setConfirmingClear(false), disabled: clearing },
        { label: t('companion.draft.clearConfirm'), variant: 'destructive', onSelect: clear, busy: clearing },
      ]}
      onDismiss={() => { if (!clearing) setConfirmingClear(false); }}
    />
  );

  // A press on the head line's words, never on one of its presses, opens the brief: the field takes the focus and the dock's
  // slot gives it its 88px back, so a pointer reaches a field that had given way to nothing (the keyboard reaches it by Tab).
  const openField = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('button') === null) fieldRef.current?.focus();
  };

  if (headLine) {
    return (
      <Card ref={cardRef} data-companion-draft={draft.target.kind} className="flex min-h-0 flex-col gap-2 border-input p-3">
        {/* The head line's one row: the target and Steer's state, then the sends, which wrap under the target where the row is
            too short for both, 14 px apart, so the target's 12 px catch under a finger stays clear of them. */}
        <div data-companion-draft-head="" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-3.5">
          <div onClick={openField} className="flex min-w-0 flex-[1_1_12rem] cursor-text items-baseline gap-2 text-sm">
            {targetWords}
            {working}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">{sends}</div>
        </div>
        {steerWords}
        {refusalLine}
        {notice}
        {/* The field's box, the field alone in it: it clips the field as it gives way, down to nothing. Its 4 px each way hold the
            field's focus ring, and its top takes back the card's gap (the field's own margin gives it), so at nothing the box adds
            no gap to the head line. Below the field's first line it draws nothing a finger or an eye can take (`useFieldRoom`),
            unless the field holds the focus: what he types is always drawn. */}
        <div
          ref={fieldBoxRef}
          data-companion-draft-field=""
          className="-mx-1 -mt-2 flex min-h-0 flex-col overflow-hidden px-1 pb-1 [&[data-field-room=none]:not(:focus-within)>*]:pointer-events-none [&[data-field-room=none]:not(:focus-within)>*]:opacity-0"
        >
          {field}
        </div>
        {clearQuestion}
      </Card>
    );
  }

  return (
    <Card ref={cardRef} data-companion-draft={draft.target.kind} className="flex min-h-0 flex-col gap-2 border-input p-3">
      <div className="flex shrink-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2 text-sm">{targetWords}</div>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {working}
          {working && <span aria-hidden="true">·</span>}
          {stamp}
        </p>
      </div>
      {field}
      {notice}
      <div className="flex shrink-0 flex-wrap items-center gap-2">{sends}</div>
      {steerWords}
      {refusalLine}
      {clearQuestion}
    </Card>
  );
}
