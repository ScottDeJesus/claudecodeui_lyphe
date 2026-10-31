import { ArrowUpRight, CheckCheck } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AskAnswers } from '@/modules/station/AskAnswers';
import { useStationNeeds } from '@/modules/station/context/StationNeedsContext';
import { StageGone } from '@/modules/station/stageStates';
import { useOpenChatInCloudcli } from '@/modules/station/hooks/useOpenChatInCloudcli';
import { api, refusalSentence } from '@/shared/api';
import { STATION_NEED_KINDS } from '@/shared/constants';
import type { StationAskKind, StationFocus, StationNeed } from '@/shared/station-types';
import type { LocaleWords } from '@/shared/types';
import { Button, Card, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** A chat's waiting ask on the stage. */
type AskFocus = Extract<StationFocus, { kind: 'ask' }>;

/** The ask as the needs hold it: its chat, its tool, what it would do whole, the rule an always keeps, its options. */
type AskNeed = Extract<StationNeed, { kind: 'ask' }>;

/**
 * What the stage holds of its ask: `loading` while the needs have not been read; `waiting`, the ask, his to answer;
 * `answered`, his answer from this stage landed, `told` the server's sentence of what it did; `unread`, the chats' asks could
 * not be read just now (the server named `ask` in its faults, or the first read of the needs failed), so whether this one still waits is not known; `gone`, no longer
 * waiting — answered in its chat or by her, its chat ended, or his press refused 409 for that reason.
 */
type AskFound =
  | { kind: 'loading' }
  | { kind: 'waiting'; need: AskNeed }
  | { kind: 'answered'; told: string }
  | { kind: 'unread' }
  | { kind: 'gone' };

/** What the well holds, said over it, by the ask's kind. */
const WELL_WORDS: Readonly<Record<StationAskKind, LocaleWords>> = {
  permission: { key: 'station.needs.ask.wellPermission', english: 'What it would run' },
  question: { key: 'station.needs.ask.wellQuestion', english: 'What it asks' },
  plan: { key: 'station.needs.ask.wellPlan', english: 'The plan' },
};

type AskStageViewProps = {
  focus: AskFocus;
  found: AskFound;
  /** The answer whose press is out (`allow`, `deny`, `always`, or the question's answer), null when none. */
  answering: string | null;
  /** The server's sentence for a refused answer (400, or 500 when it could not be sent), said under the answers; null when none. */
  refusal: string | null;
  /** A press: the answer's word for the server — `allow`, `deny`, `always`, an option's label, or his own words. */
  onAnswer: (answer: string) => void;
  /** Try again, while the asks could not be read: what needs him read once more. */
  onReread: () => void;
  /** "Open the chat": the chat the ask waits in, in CloudCLI. */
  onOpenChat: () => void;
};

/**
 * A CHAT'S WAITING ASK ON THE STAGE, answered here or nowhere on the station: the rail only brings it here (the lock law, for
 * a permission's command as for a census — the tail of a command is where `rsync --delete` sits).
 *
 * The stage's head names the chat. Under it: the ask's kind as its glyph and word, a permission's tool, and how many more
 * asks wait behind it; then what it would do, WHOLE — `what` as the server decides on it, in a well that wraps and, past half
 * the screen's height, scrolls inside itself, never the page; in mono for a permission's command, in the body face for a
 * question's or a plan's prose — under the caption that says what it is ("What it would run", "What it asks", "The plan");
 * then the answers (`AskAnswers`): a permission's Allow, Deny and Always allow with the rule it keeps; a question's options and
 * his own words; a plan's Approve and Send back. Where the rail's press sends the keyboard is the answers' group, never a
 * button: labelled by the ask's kind and described by the well, so what a press would approve is read on arrival, and a second
 * Enter from the rail approves nothing. A refused answer is said under them in the warn ink with its ▲; "Open the chat" last.
 *
 * Answered from here: "Answered" with the server's sentence of what it did. Unread (the chats' asks could not be read just
 * now): the rail's own fault line, "▲ Couldn’t read the permissions just now", with Try again and "Open the chat" — never
 * "answered elsewhere" over a chat still blocked on its ask. Gone: "That ask was answered elsewhere." Every answer, Try again
 * and "Open the chat" is a 44 px catch under a finger below 768 px (the touch law).
 *
 * A pure view: `AskStage` below binds it. Drawn on the stage for an `ask` focus (`stageViews.ts`),
 * and by `.verify/kaylee-station-shots.mjs` on its fixture (`fake/needs.ts`).
 */
export function AskStageView({ focus, found, answering, refusal, onAnswer, onReread, onOpenChat }: AskStageViewProps) {
  const { t } = useTranslation();
  const wellId = useId();
  // The kind's word, which names the answers' group, and the well, which describes it: read as the keyboard lands there.
  const kindId = useId();
  const whatId = useId();

  const openChat = (quiet: boolean) => (
    // A 44 px catch under a finger below 768 px, as every answer above it.
    <Button variant={quiet ? 'ghost' : 'outline'} size="sm" data-station-ask-open="" className="self-start finger:h-11" onClick={onOpenChat}>
      {t('station.needs.openChat', 'Open the chat')}
      <ArrowUpRight aria-hidden="true" />
    </Button>
  );

  switch (found.kind) {
    case 'loading':
      return (
        <div data-station-ask="loading" className="grid place-items-center py-10">
          <Spinner size={32} label={t('station.needs.ask.looking', 'Looking for the ask…')} />
        </div>
      );
    case 'gone':
      return (
        <div data-station-ask="gone" className="flex min-w-0 flex-col gap-3">
          <StageGone focus={focus} />
          {openChat(false)}
        </div>
      );
    case 'answered':
      return (
        <div data-station-ask="answered" className="flex min-w-0 flex-col gap-3">
          <Card data-tone="positive" className="flex min-w-0 items-start gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tone-soft text-tone-ink">
              <CheckCheck aria-hidden="true" className="size-4" />
            </span>
            <div role="status" className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t('station.needs.ask.answered', 'Answered')}</p>
              <p className="mt-0.5 break-words text-sm text-muted-foreground">{found.told}</p>
            </div>
          </Card>
          {openChat(false)}
        </div>
      );
    case 'unread':
      return (
        <div data-station-ask="unread" className="flex min-w-0 flex-col gap-3">
          <p role="status" data-tone="warn" className="flex min-w-0 items-start gap-1.5 text-sm leading-snug text-tone-ink">
            <span aria-hidden="true">▲</span>
            <span className="min-w-0 break-words">{t('station.needs.fault.ask', 'Couldn’t read the permissions just now')}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" data-station-ask-retry="" className="finger:h-11" onClick={onReread}>
              {t('station.needs.retry', 'Try again')}
            </Button>
            {openChat(true)}
          </div>
        </div>
      );
    case 'waiting':
      break;
  }

  const { need } = found;
  const look = STATION_NEED_KINDS[need.ask];
  const KindIcon = look.icon;

  return (
    <div data-station-ask={need.ask} className="flex min-w-0 flex-col gap-4">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <KindIcon aria-hidden="true" className="size-4 shrink-0" />
        <span id={kindId} className="font-medium text-foreground">{t(look.word.key, look.word.english)}</span>
        {need.ask === 'permission' && (
          <>
            <span aria-hidden="true">·</span>
            <code className="min-w-0 break-all font-mono text-[13px] text-foreground">{need.tool}</code>
          </>
        )}
        {need.more > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t('station.needs.ask.more', { count: need.more, defaultValue: '{{count}} more waiting behind it' })}</span>
          </>
        )}
      </p>

      <div className="flex min-w-0 flex-col gap-1.5">
        {/* The house's caption type (MAN-742), in the muted ink, which holds AA where the faint does not. */}
        <p id={wellId} className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          {t(WELL_WORDS[need.ask].key, WELL_WORDS[need.ask].english)}
        </p>
        <div
          id={whatId}
          role="region"
          aria-labelledby={wellId}
          tabIndex={0}
          data-station-ask-what=""
          className={cn(
            'scrollbar-thin max-h-[50dvh] min-h-0 overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-2.5 leading-relaxed text-foreground [overflow-wrap:anywhere]',
            // A command in mono, as it runs; a question's or a plan's prose in the body face, as it reads.
            need.ask === 'permission' ? 'font-mono text-[13px]' : 'text-sm',
          )}
        >
          {need.what}
        </div>
      </div>

      <AskAnswers need={need} answering={answering} onAnswer={onAnswer} labelId={kindId} whatId={whatId} />

      {refusal !== null && (
        <p role="alert" data-tone="warn" className="flex min-w-0 items-start gap-1.5 text-sm leading-snug text-tone-ink">
          <span aria-hidden="true">▲</span>
          <span className="min-w-0 break-words">{refusal}</span>
        </p>
      )}

      {openChat(true)}
    </div>
  );
}

/** The sentence for an answer the server's `told` did not carry (a proxy's 200, a server of another shape): the answer did land. */
const ANSWER_SENT: LocaleWords = { key: 'station.needs.ask.sent', english: 'Your answer was sent.' };

/** The `told` of a 200's body, else null: the server's sentence of what it did with his answer. */
function toldOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const { told } = body as { told?: unknown };
  return typeof told === 'string' && told !== '' ? told : null;
}

/**
 * The ask's stage on the page: registered for the `ask` kind in `stageViews.ts`, drawn by `StationStage`. It finds the ask in
 * what needs him, sends his answer through the station's own door (`POST /api/companion/station/asks`, which decides it as the
 * chat's own forms do), and hands every state to `AskStageView`. Nothing here answers on its own: each answer is a press on
 * a control the stage draws.
 */
export function AskStage({ focus }: { focus: AskFocus }) {
  const { t } = useTranslation();
  const { needs, faults, failure, reread } = useStationNeeds();
  const openChat = useOpenChatInCloudcli();
  // The server's sentence of what it did with his answer from this stage. State, because "Answered" draws from it and it must
  // outlast the ask itself: the answer takes the ask off the list, and without this the stage would call it "answered elsewhere".
  const [told, setTold] = useState<string | null>(null);
  // The server refused the ask as no longer waiting (409). State, because it is the stage's gone state and the list may not have moved yet.
  const [refusedAsGone, setRefusedAsGone] = useState(false);
  // The answer whose `POST /asks` is out. State, because the answers draw busy from it and no second press is taken meanwhile.
  const [answering, setAnswering] = useState<string | null>(null);
  // A 400's or a 500's sentence, said under the answers until the next press. State, because it is drawn.
  const [refusal, setRefusal] = useState<string | null>(null);

  const waiting = needs?.find((need): need is AskNeed => need.kind === 'ask' && need.sessionId === focus.sessionId && need.requestId === focus.requestId);
  let found: AskFound;
  if (told !== null) found = { kind: 'answered', told };
  else if (refusedAsGone) found = { kind: 'gone' };
  // The first read failed (the provider holds `failure` only while it has no list): the rail says so with Try again, and so does this stage, which would otherwise look for the ask forever.
  else if (needs === null) found = failure === null ? { kind: 'loading' } : { kind: 'unread' };
  else if (waiting !== undefined) found = { kind: 'waiting', need: waiting };
  // The chats' asks could not be read: whether this one still waits is not known, which is never "answered elsewhere".
  else if (faults.includes('ask')) found = { kind: 'unread' };
  else found = { kind: 'gone' };

  const onAnswer = (answer: string) => {
    if (answering !== null) return;
    setAnswering(answer);
    setRefusal(null);
    void (async () => {
      try {
        const response = await api.companion.station.answerAsk({ sessionId: focus.sessionId, requestId: focus.requestId, answer });
        if (response.ok) {
          const body: unknown = await response.json().catch(() => null);
          setTold(toldOf(body) ?? t(ANSWER_SENT.key, ANSWER_SENT.english));
        } else if (response.status === 409) {
          setRefusedAsGone(true);
        } else {
          setRefusal((await refusalSentence(response)) ?? t('station.needs.ask.refused', 'The answer could not be sent just now.'));
        }
      } catch (error) {
        console.warn('[Station] Could not send the answer to the ask:', error);
        setRefusal(t('station.needs.ask.unreached', 'The server could not be reached; the ask is still waiting.'));
      } finally {
        setAnswering(null);
      }
    })();
  };

  return (
    <AskStageView
      focus={focus}
      found={found}
      answering={answering}
      refusal={refusal}
      onAnswer={onAnswer}
      onReread={reread}
      onOpenChat={() => openChat(focus.sessionId)}
    />
  );
}
