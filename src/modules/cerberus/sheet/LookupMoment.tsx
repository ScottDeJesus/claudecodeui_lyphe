import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { StatusGlyph } from '@/modules/cerberus/StatusMarks';
import { STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCheckView, CerberusLookup, CerberusStatus } from '@/shared/cerberus-types';
import { Input } from '@/shared/ui';

/** A time the input holds once it is whole: "17:52" or "17:52:10". While one is half typed, the input holds "". */
const WHOLE_TIME = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * What the sentence reads off the check it is about. The lookup alone is not enough: `staleAfter` is
 * the "90 s" a stale answer quotes, `origin` says whether the result came from Cerberus itself (`self`)
 * or from a warden, and `at` is the latest result, which "That hasn't happened yet" points back to.
 * The sheet and History both hold the whole `CerberusCheckView` and pass it.
 */
type LookupCheck = Pick<CerberusCheckView, 'at' | 'origin' | 'staleAfter'>;

/** "90 s", "15 min", "1 h": a number of seconds in the largest unit that says it exactly. */
function stretchOf(t: TFunction, seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return t('cerberus.time.hours', { count: seconds / 3600 });
  if (seconds >= 60 && seconds % 60 === 0) return t('cerberus.time.minutes', { count: seconds / 60 });
  return t('cerberus.time.seconds', { count: seconds });
}

/** "From the result recorded 17:52:00 by the warden on eis1", with "· muted then: <reason>" when a mute covered the moment. */
function resultMeta(t: TFunction, lookup: CerberusLookup, fromCerberus: boolean): string | null {
  if (lookup.resultAt === null) return null;
  const time = hms(lookup.resultAt);
  if (lookup.mute !== null) {
    const reason = lookup.mute.reason;
    return fromCerberus
      ? t('cerberus.lookup.metaHubMuted', { time, reason })
      : t('cerberus.lookup.metaMuted', { time, node: lookup.node, reason });
  }
  return fromCerberus ? t('cerberus.lookup.metaHub', { time }) : t('cerberus.lookup.meta', { time, node: lookup.node });
}

/** One answer as the row draws it: the status its glyph shows, the sentence, and the meta under it. */
type Answer = { status: CerberusStatus; sentence: string; meta: string | null };

/**
 * Each verdict in words. Only `result` has a status of its own. The other three show the neutral —,
 * because "no result" is never passing, and say why under it.
 */
function answerOf(t: TFunction, language: string | undefined, lookup: CerberusLookup, check: LookupCheck): Answer {
  const unknownMeta = t('cerberus.lookup.unknownMeta');
  if (lookup.verdict === 'future') {
    const meta = check.at === null ? null : t('cerberus.lookup.futureMeta', { time: hms(check.at) });
    return { status: 'unknown', sentence: t('cerberus.lookup.future'), meta };
  }
  if (lookup.verdict === 'too_early') {
    return { status: 'unknown', sentence: t('cerberus.lookup.tooEarly'), meta: unknownMeta };
  }
  if (lookup.verdict === 'stale') {
    const sentence = t('cerberus.lookup.stale', { staleAfter: stretchOf(t, check.staleAfter) });
    return { status: 'unknown', sentence, meta: unknownMeta };
  }
  const status = lookup.status ?? 'unknown';
  const time = hms(lookup.at);
  const word = t(STATUS_TABLE[status].wordKey).toLocaleLowerCase(language);
  // The reported value sits mid-sentence and the sentence brings its own full stop, so the value's
  // own stop is dropped. "…expired.." would read as a typo.
  const value = lookup.value?.trim().replace(/\.+$/u, '') ?? '';
  const sentence = value
    ? t('cerberus.lookup.was', { time, word, value })
    : t('cerberus.lookup.wasNoValue', { time, word });
  return { status, sentence, meta: resultMeta(t, lookup, check.origin === 'self') };
}

/**
 * The glyph, then the sentence over its meta: one layout for every answer, and for the prompt to
 * type a time. The glyph is `still` because the moment may be long past, and `decorative` because
 * the sentence says the word. `text-pretty` keeps a lone "s." or "out." off a line of its own.
 */
function SentenceRow({ status, sentence, meta }: Answer) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <StatusGlyph status={status} decorative still />
      <div className="min-w-0">
        <p className="text-pretty text-sm text-foreground [overflow-wrap:anywhere]">{sentence}</p>
        {meta !== null && <p className="text-pretty text-xs text-ink-faint [overflow-wrap:anywhere]">{meta}</p>}
      </div>
    </div>
  );
}

/**
 * WHAT A CHECK WAS AT ONE MOMENT, in a sentence with its glyph:
 * - "At 17:52:10 it was failing — <value>."
 * - "That hasn't happened yet."
 * - "No result recorded that early."
 * - "No result then — the last one was older than 90 s."
 *
 * The meta under it says where the answer came from: "From the result recorded 17:52:00 by the warden
 * on eis1 · muted then: <reason>". Each sentence names its own moment, so while a newly typed time is
 * being read, the answer still on screen stays true about the time it names.
 *
 * Used by `LookupMoment` (the sheet) and by History's "Look up a check" card, which has inputs of its
 * own. It is no live region itself: a caller that draws it alone puts it inside a stable
 * `aria-live="polite"` element, as `LookupMoment` does, so a new answer is announced.
 */
export function LookupSentence({ lookup, check }: { lookup: CerberusLookup; check: LookupCheck }) {
  const { t, i18n } = useTranslation();
  return <SentenceRow {...answerOf(t, i18n.resolvedLanguage, lookup, check)} />;
}

/**
 * "LOOK UP A MOMENT": a time input with seconds, then the sentence for the moment it holds. `time` is
 * the input's own "HH:MM:SS" and `onTimeChange` gets each new one. Turning it into a moment and
 * reading the lookup is the caller's, and `lookup` is whatever that read last answered. A cleared or
 * half-typed time shows "Type a time like 17:52:10." instead of an answer for a time that isn't there.
 *
 * Used by the sheet (`CheckSheet`), whose fill wires `onTimeChange` and the read behind `lookup`.
 */
export function LookupMoment({ time, onTimeChange, lookup, check }: {
  time: string;
  onTimeChange: (time: string) => void;
  lookup: CerberusLookup;
  check: LookupCheck;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Input
        type="time"
        step={1}
        value={time}
        onChange={(event) => onTimeChange(event.target.value)}
        aria-label={t('cerberus.lookup.title')}
        className="w-44 flex-none tabular-nums"
      />
      {/* The live region is this column, which outlives every answer. Switching between the prompt and an
          answer remounts what is inside it, and a region must exist before its content changes, so the
          answer to a typed time is announced. History, which draws `LookupSentence` alone, wraps it in
          a region of its own the same way. */}
      <div aria-live="polite" aria-atomic="true" className="min-w-0 flex-[1_1_220px]">
        {WHOLE_TIME.test(time)
          ? <LookupSentence lookup={lookup} check={check} />
          : <SentenceRow status="unknown" sentence={t('cerberus.lookup.typeATime')} meta={null} />}
      </div>
    </div>
  );
}
