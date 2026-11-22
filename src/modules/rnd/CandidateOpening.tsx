import type { TFunction } from 'i18next';
import { useId } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { OPENING_WIDTH_PX, WORD_TONE, hostOf } from '@/modules/rnd/rndWords';
import type { RndCandidate } from '@/shared/rnd-types';
import type { AstrolabePoint } from '@/shared/types';
import { Banner, Button, Excerpt, KeyValueList, Opening, Rule } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

type CandidateOpeningProps = {
  /** The open candidate, or null while none is open. */
  candidate: RndCandidate | null;
  /** The open row's mark, in client coordinates. */
  anchor: () => AstrolabePoint | null;
  /** The open row's own extent, so the plate stands clear of it where the room allows. */
  avoid: () => { left: number; right: number } | null;
  /** Beside the list where the room holds the plate whole; under its row where it does not. */
  side: 'right' | 'below';
  /** A press on this candidate is out: its acts wait. */
  busy: boolean;
  /** The dispatcher's sentence for a press on this candidate it refused, or null. */
  refusal: string | null;
  onClose: () => void;
  onSpike: () => void;
  onOpenChat: () => void;
  /** Opens the Adopt question. */
  onAdopt: () => void;
  /** Opens the Reject question. */
  onReject: () => void;
  onReopen: () => void;
  /** The question open over it (Adopt, Reject): drawn inside, so a press in one never reads as a press outside. */
  children?: ReactNode;
};

/** How many lines of evidence stand at once; the rest scroll inside the excerpt. */
const EVIDENCE_ROWS = 12;

/**
 * A value that is a sentence or more, or a path. The list cuts a value to one line, and a finger cannot reach the title that
 * holds the rest; these are what he reads to decide, so they wrap. head is a short line said over the words (a verdict and its age).
 */
function said(words: string, head?: string): ReactNode {
  return (
    <span className="block whitespace-normal break-words text-xs leading-relaxed">
      {head !== undefined && <span className="block">{head}</span>}
      {words}
    </span>
  );
}

/** The evidence as the spike wrote it: its first line is the verdict's own sentence, the rest its measurements and paths. */
function evidenceOf(candidate: RndCandidate): { sentence: string; rest: string } {
  const lines = (candidate.verdict?.evidence ?? '').split('\n');
  return { sentence: lines[0].trim(), rest: lines.slice(1).join('\n') };
}

/** The candidate's facts, in the order he needs them: what it is, why, the question, where it is from, then what has happened to it. */
function factsOf(candidate: RndCandidate, t: TFunction): Array<readonly [string, ReactNode]> {
  const source = (
    <a
      className="underline underline-offset-2 finger:inline-block finger:py-3.5"
      href={candidate.source_url}
      target="_blank"
      rel="noreferrer"
      title={candidate.source_url}
    >
      {candidate.source_url.replace(/^https?:\/\//, '')}
    </a>
  );
  const facts: Array<readonly [string, ReactNode]> = [
    [t('rnd.opening.what'), said(candidate.what)],
    [t('rnd.opening.why'), said(candidate.why)],
    [t('rnd.opening.question'), said(candidate.question)],
    [t('rnd.opening.source'), source],
  ];
  // A spike that never answers stays spiking until he presses again: how long it has been out is the one sign of that.
  if (candidate.word === 'spiking' && candidate.spike !== null) facts.push([t('rnd.opening.spikeStarted'), formatRelativeTime(candidate.spike.started_at)]);
  if (candidate.verdict !== null) {
    const stamp = t('rnd.opening.verdictValue', { word: t('rnd.opening.verdictWord.' + candidate.verdict.word), ago: formatRelativeTime(candidate.verdict.at) });
    // The verdict's own sentence is said here as words, whole; a no's sentence is already said as why it was rejected.
    const { sentence } = evidenceOf(candidate);
    facts.push([t('rnd.opening.verdict'), sentence === '' || sentence === candidate.rejected?.why ? stamp : said(sentence, stamp)]);
    if (candidate.verdict.dir !== null) facts.push([t('rnd.opening.dir'), said(candidate.verdict.dir)]);
  }
  if (candidate.rejected !== null) facts.push([t('rnd.opening.rejectedBecause'), said(candidate.rejected.why)]);
  if (candidate.adopted !== null) {
    const { plan, word, epic } = candidate.adopted;
    facts.push([t('rnd.opening.became'), t('rnd.opening.becameValue', { plan, word, epic })]);
  }
  return facts;
}

/**
 * A CANDIDATE, OPENED: hung from its row, it holds everything the row left out. Under its title stand the acts; then the four
 * things he reads to decide (what it is, why it might help, the question a spike would settle, the page it came from) and what
 * has happened to it where anything has (when its spike started, the verdict and its sentence, the spike's directory, why it was
 * rejected, the feature it became); then the rest of the spike's evidence as it was written.
 *
 * THE ACTS STAND FIRST, where no length can move them: the store lets what it is and why run to 1200 characters each, and a
 * press under them would leave the plate. They are in the same place on every candidate, so the hand learns it.
 *
 * THE ACTS GO BY ITS WORD, the main one first. Waiting: Spike, Reject. Spiking: Open chat, Spike again, Reject. Proved: Adopt,
 * Spike again, Reject. Rejected: Bring back. An adopted candidate has none: it is the roadmap's now. Reject is quiet, never red:
 * it is undone with Bring back, and the reason it asks for is what keeps the scout from filing the same thing again.
 *
 * A REFUSAL IS SAID OVER THE ACTS in the dispatcher's own sentence, beside the press that drew it.
 *
 * Rendered by RndPanel, which hands it the open row's mark, the side the room allows and the question open over it.
 */
export function CandidateOpening({ candidate, anchor, avoid, side, busy, refusal, onClose, onSpike, onOpenChat, onAdopt, onReject, onReopen, children }: CandidateOpeningProps) {
  const { t } = useTranslation();
  const evidenceId = useId();

  // The age first: the plate says it nowhere else, and the caption is one line that a long host would cut it out of. The host
  // is said again in Source.
  const caption = candidate === null ? '' : t('rnd.opening.filed', { ago: formatRelativeTime(candidate.filed_at) }) + ' · ' + hostOf(candidate.source_url);
  const evidence = candidate === null ? '' : evidenceOf(candidate).rest;

  const acts = () => {
    if (candidate === null) return null;
    const reject = (
      <Button variant="ghost" className="finger:h-11" disabled={busy} onClick={onReject} data-rnd-act="reject">
        {t('rnd.act.reject')}
      </Button>
    );
    const again = (
      <Button variant="outline" className="finger:h-11" disabled={busy} onClick={onSpike} data-rnd-act="spike-again">
        {t('rnd.act.spikeAgain')}
      </Button>
    );
    if (candidate.word === 'waiting') {
      return (
        <>
          <Button className="finger:h-11" busy={busy} onClick={onSpike} data-rnd-act="spike">{t('rnd.act.spike')}</Button>
          {reject}
        </>
      );
    }
    if (candidate.word === 'spiking') {
      return (
        <>
          <Button className="finger:h-11" busy={busy} onClick={onOpenChat} data-rnd-act="open-chat">{t('rnd.act.openChat')}</Button>
          {again}
          {reject}
        </>
      );
    }
    if (candidate.word === 'proved') {
      return (
        <>
          <Button className="finger:h-11" busy={busy} onClick={onAdopt} data-rnd-act="adopt">{t('rnd.act.adopt')}</Button>
          {again}
          {reject}
        </>
      );
    }
    if (candidate.word === 'rejected') {
      return <Button className="finger:h-11" busy={busy} onClick={onReopen} data-rnd-act="reopen">{t('rnd.act.reopen')}</Button>;
    }
    return <p className="text-xs text-muted-foreground">{t('rnd.opening.adoptedNote')}</p>;
  };

  return (
    <Opening
      open={candidate !== null}
      anchor={anchor}
      avoid={avoid}
      side={side}
      onClose={onClose}
      backLabel={t('rnd.opening.back')}
      source={caption}
      title={candidate?.title}
      status={candidate === null ? undefined : { word: t('rnd.word.' + candidate.word), tone: WORD_TONE[candidate.word] }}
      width={OPENING_WIDTH_PX}
      marks={{ 'data-rnd-opening': candidate?.name ?? '', 'data-rnd-opening-word': candidate?.word ?? '' }}
    >
      {candidate !== null && (
        <div className="flex flex-col gap-4">
          {refusal !== null && <Banner tone="warn">{refusal}</Banner>}
          <div className="flex flex-wrap items-center gap-2.5" data-rnd-acts={candidate.word}>
            {acts()}
          </div>
          <KeyValueList items={factsOf(candidate, t)} />
          {evidence.trim() !== '' && (
            <section aria-labelledby={evidenceId} className="flex flex-col gap-2">
              <Rule id={evidenceId} level={4}>{t('rnd.opening.evidence')}</Rule>
              <Excerpt text={evidence} label={t('rnd.opening.evidence')} start={2} rows={EVIDENCE_ROWS} />
            </section>
          )}
        </div>
      )}
      {children}
    </Opening>
  );
}
