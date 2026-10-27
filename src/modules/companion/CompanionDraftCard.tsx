import { MessageSquarePlus, Send } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCardFloor } from '@/modules/companion/hooks/useCardFloor';
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
};

/** The house's eyebrow (MAN-742): it names the card, and states nothing on its own. */
const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

/**
 * THE DRAFT: the one thing ever sent to a chat, so its target and its words are always on screen and his to edit.
 * Drawn by this module's CompanionPanel, last in the dock, right above the composer.
 *
 * TOP: "DRAFT" and the target — "For Kanban lanes · claudecodeui_lyphe", or "New chat in claudecodeui_lyphe" — where the
 * chat's name keeps its room and the project gives way first; under it "Working now" while that chat runs a turn, and when
 * she last changed the draft. BODY: the words, in a field he can edit that grows with them into whatever room the dock
 * leaves — the notes give way first, down to their floor — and scrolls inside past that, never below its 88px floor, so a
 * brief built over a walkthrough is read as whole as the screen allows. Only the field gives way inside the card: the
 * target, the notice and the sends always stand. FOOT: the sends and Clear. While the target is working, Send steer leads
 * (it folds the brief into the turn running now) and Send turn follows; otherwise Send turn stands alone. Clear asks
 * first: a brief built over a walkthrough is work.
 *
 * HIS EDIT IS HELD HERE, so typing never waits on the server. It is saved when the field loses focus, and BEFORE A SEND,
 * so what is sent is exactly what he sees. While he has no edit the field shows her draft and follows her rewrites as
 * they land; a rewrite that lands under an unsaved edit is said ("Kaylee changed the draft while you were editing")
 * with Use hers, never silently kept or dropped — and his own save coming back while he types on is his, never hers.
 * A refused send or save leaves everything on screen and says why.
 */
export function CompanionDraftCard({ draft, name, targetWorking, visible, onEdit, onSend, onClear }: CompanionDraftCardProps) {
  const { t } = useTranslation();
  const pushToast = useToast();
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // His edit while it differs from the draft: unsaved, or saving. Null when the field simply shows her draft.
  const [edit, setEdit] = useState<string | null>(null);
  // The draft text his edit started from: a draft that moves off it (and not onto his own words) is her rewrite.
  const [editBase, setEditBase] = useState('');
  // The words his latest save carried. A draft that arrives equal to them is his own save's echo — he may have typed on
  // since — so it becomes the edit's new base instead of reading as her rewrite.
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

  // The card's own floor (all of it but the field, plus the field's 88px), so the dock scrolls it whole, never folds it.
  useCardFloor(cardRef, fieldRef, visible);

  const shown = edit ?? draft.text;
  const theirsChanged = edit !== null && draft.text !== editBase && draft.text !== edit;
  const empty = shown.trim().length === 0;
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
    setOwnSave(words);
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
        className="[@media(pointer:coarse)]:h-11"
      >
        {lead && <Send aria-hidden="true" />}
        {t(mode === 'steer' ? 'companion.draft.sendSteer' : 'companion.draft.sendTurn')}
      </Button>
    );
    return mode === 'steer' ? <Tooltip key={mode} content={t('companion.draft.steerHint')} position="top">{button}</Tooltip> : button;
  };

  return (
    <Card ref={cardRef} data-companion-draft={draft.target.kind} className="flex min-h-0 flex-col gap-2 border-input p-3">
      <div className="flex shrink-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className={cn(EYEBROW, 'shrink-0')}>{t('companion.draft.title')}</span>
          {draft.target.kind === 'new' && <MessageSquarePlus aria-hidden="true" className="size-3.5 shrink-0 self-center text-muted-foreground" />}
          <span data-companion-draft-target="" className="min-w-0 truncate font-medium text-foreground">{target}</span>
          {/* Shrinks four times as fast as the name: the chat he knows is named before the project it lives in. */}
          {draft.target.kind === 'session' && <span className="min-w-0 shrink-[4] truncate text-xs text-muted-foreground">· {draft.target.session.project}</span>}
        </div>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {draft.target.kind === 'session' && targetWorking && (
            <span data-tone="info" className="flex shrink-0 items-center gap-1.5 font-medium text-tone-ink">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-tone-dot motion-safe:animate-pulse" />
              {t('companion.draft.working')}
              <span aria-hidden="true" className="text-muted-foreground">·</span>
            </span>
          )}
          <span className="truncate">{t('companion.draft.updated', { when: formatRelativeTime(draft.updatedAt) })}</span>
        </p>
      </div>

      <label htmlFor={fieldId} className="sr-only">{t('companion.draft.fieldLabel', { about })}</label>
      <TextArea
        ref={fieldRef}
        id={fieldId}
        rows={3}
        value={shown}
        onChange={(event) => type(event.target.value)}
        onBlur={saveOnLeave}
        className="overflow-y-auto"
      />

      {theirsChanged && (
        <p data-tone="info" className="flex shrink-0 flex-wrap items-center gap-x-2 text-xs text-tone-ink">
          {t('companion.draft.theirsChanged', { name })}
          <Button variant="link" size="sm" className="h-auto px-0 py-0 text-xs" onClick={() => setEdit(null)}>
            {t('companion.draft.useTheirs', { name })}
          </Button>
        </p>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {/* Send turn and Send steer both send through `onSend`, which the panel's shell binds to the send verb. */}
        {targetWorking && draft.target.kind === 'session' ? [sendButton('steer', true), sendButton('turn', false)] : sendButton('turn', true)}
        <Button
          variant="ghost"
          size="sm"
          disabled={sending !== null}
          // The panel holds two Clears: this one discards the brief, the header's wipes her memory. `ml-auto`, not a
          // spacer before it: when the row wraps on a narrow phone, Clear stands at the right end of its own line, apart
          // from the sends, never under the lead one.
          aria-label={t('companion.draft.clearLabel')}
          onClick={() => setConfirmingClear(true)}
          className="ml-auto text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:h-11"
        >
          {t('companion.draft.clear')}
        </Button>
      </div>
      {refusal !== null && (
        <p role="alert" data-tone="warn" className="flex shrink-0 items-start gap-1.5 text-xs leading-relaxed text-tone-ink">
          <span aria-hidden="true">▲</span>
          {refusal}
        </p>
      )}

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
    </Card>
  );
}
