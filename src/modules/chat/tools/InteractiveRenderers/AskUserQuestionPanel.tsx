import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';

import type { PermissionPanelProps, Question } from '@/shared/types';
import { Badge, Button, Card, Input } from '@/shared/ui';
import { QuestionText } from '@/modules/chat/tools/ContentRenderers/QuestionText';
import { QuestionOptionRow } from '@/modules/chat/tools/InteractiveRenderers/QuestionOptionRow';

/** Stable fallback so the memoized handlers below are not invalidated on every
 *  render by a fresh `[]` literal when a request carries no questions. */
const NO_QUESTIONS: Question[] = [];

/** A text field: input, textarea, or anything contenteditable. */
const isTextEntry = (element: Element | null): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLElement && element.isContentEditable);

/**
 * A text field with something typed in it. The hazard of taking focus is the
 * sentence a person is mid-way through, not the field itself: after they send a
 * prompt the composer keeps focus but holds nothing, and a panel that deferred to
 * an EMPTY field would leave every shortcut it advertises inert until clicked.
 */
const holdsDraft = (element: Element | null): boolean => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value.trim().length > 0;
  if (element instanceof HTMLElement && element.isContentEditable) return (element.textContent ?? '').trim().length > 0;
  return false;
};

/**
 * Registered by chat's PermissionRequestsBanner as the permission panel for
 * AskUserQuestion requests, so the user answers the model's questions inline.
 */
export const AskUserQuestionPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const { t } = useTranslation('chat');
  const input = request.input as { questions?: Question[] } | undefined;
  const questions: Question[] = input?.questions ?? NO_QUESTIONS;

  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(() => new Map());
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Focus the container for keyboard events when the panel mounts and when the step changes —
  // unless a person is mid-sentence in a text field. The panel mounts inside the transcript
  // while the composer stays on screen, and pulling focus out of a draft would turn their next
  // digits into option toggles and their Enter into an answer they never chose. An empty field
  // is not a draft: the panel takes focus, so `1`, `Enter` and `Esc` work as its chips promise.
  // `preventScroll`: the panel lives inside the transcript, whose scroll position has one owner
  // (`useChatSessionState`, docs/architecture/MANUAL.md (05-scrolling)). A bare focus() on a row 900px
  // down dragged the pane to it — the same silent jump the owner's own writers guard against
  // — so the pane's follow logic decides whether the new row is brought into view, never this.
  useEffect(() => {
    if (otherActive.get(currentStep)) return;
    if (holdsDraft(document.activeElement)) return;
    containerRef.current?.focus({ preventScroll: true });
  }, [currentStep, otherActive]);

  useEffect(() => {
    if (otherActive.get(currentStep)) {
      otherInputRef.current?.focus();
    }
  }, [otherActive, currentStep]);

  const toggleOption = useCallback((qIdx: number, label: string, multiSelect: boolean) => {
    setSelections(prev => {
      const next = new Map(prev);
      const current = new Set(next.get(qIdx) || []);
      if (multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
        setOtherActive(p => { const n = new Map(p); n.set(qIdx, false); return n; });
      }
      next.set(qIdx, current);
      return next;
    });
  }, []);

  const toggleOther = useCallback((qIdx: number, multiSelect: boolean) => {
    setOtherActive(prev => {
      const next = new Map(prev);
      const wasActive = next.get(qIdx) || false;
      next.set(qIdx, !wasActive);
      if (!multiSelect && !wasActive) {
        setSelections(p => { const n = new Map(p); n.set(qIdx, new Set()); return n; });
      }
      return next;
    });
  }, []);

  const setOtherText = useCallback((qIdx: number, text: string) => {
    setOtherTexts(prev => { const next = new Map(prev); next.set(qIdx, text); return next; });
  }, []);

  const buildAnswers = useCallback(() => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const selected = Array.from(selections.get(idx) || []);
      const isOther = otherActive.get(idx) || false;
      const otherText = (otherTexts.get(idx) || '').trim();
      if (isOther && otherText) selected.push(otherText);
      if (selected.length > 0) answers[q.question] = selected.join(', ');
    });
    return answers;
  }, [questions, selections, otherActive, otherTexts]);

  const handleSubmit = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: buildAnswers() } });
  }, [onDecision, request.requestId, input, buildAnswers]);

  const handleSkip = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: {} } });
  }, [onDecision, request.requestId, input]);

  // Keyboard handler for number keys and navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't capture keys when typing in the "Other" input
    if (e.target instanceof HTMLInputElement) return;

    const q = questions[currentStep];
    if (!q) return;
    const multi = q.multiSelect || false;
    const optCount = q.options.length;

    // Number keys 1-9 for options
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= optCount) {
      e.preventDefault();
      toggleOption(currentStep, q.options[num - 1].label, multi);
      return;
    }

    // 0 for "Other"
    if (e.key === '0') {
      e.preventDefault();
      toggleOther(currentStep, multi);
      return;
    }

    // Enter to advance / submit
    if (e.key === 'Enter') {
      e.preventDefault();
      const isLast = currentStep === questions.length - 1;
      if (isLast) handleSubmit();
      else setCurrentStep(s => s + 1);
      return;
    }
  }, [currentStep, questions, toggleOption, toggleOther, handleSubmit]);

  // Escape skips — from a window-level CAPTURE listener, the shape the accounts panel uses
  // (docs/MANUAL.md (accounts)). ChatInterface aborts the running turn from a document-level capture
  // listener gated on `defaultPrevented`, and window capture runs first: marking the event here
  // is what keeps "Skip all — Esc" from killing the run instead. Only a key pressed INSIDE the
  // panel is the panel's: elsewhere Escape keeps its app-wide meaning. And inside the "Other"
  // field it is "back out of this field", never "skip every question and discard what I typed"
  // — marked, so the run survives, and nothing more.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) return;
      if (!containerRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      if (isTextEntry(document.activeElement)) return;
      handleSkip();
    };
    window.addEventListener('keydown', onEscape, { capture: true });
    return () => window.removeEventListener('keydown', onEscape, { capture: true });
  }, [handleSkip]);

  if (questions.length === 0) return null;

  const total = questions.length;
  const isSingle = total === 1;
  const q = questions[currentStep];
  const multi = q.multiSelect || false;
  const selected = selections.get(currentStep) || new Set<string>();
  const isOtherOn = otherActive.get(currentStep) || false;
  const isLast = currentStep === total - 1;
  const isFirst = currentStep === 0;
  const hasCurrentSelection = selected.size > 0 || (isOtherOn && (otherTexts.get(currentStep) || '').trim().length > 0);

  // Keyboard help, so it gives way below `sm`: with it, "Skip all · Back · Submit" in German or
  // Russian ran past a 390px card and clipped Submit against its edge.
  const keyHintClass = 'ml-1.5 hidden font-mono text-[10px] opacity-60 sm:inline';

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-question-card="pending"
      className={`w-full outline-none transition-all duration-500 ease-out ${
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
      }`}
    >
      <Card className="overflow-hidden shadow-none">
        {/* Header: who is asking and about what, then the question in body type. */}
        <div className="px-3 pb-2 pt-3 sm:px-4">
          <div className="mb-2 flex min-w-0 items-center gap-2">
            {/* Pending, in the frame's "Waiting for you" tone. */}
            <span aria-hidden className="vv-pulse h-2 w-2 flex-shrink-0 rounded-full bg-warn-ink" />
            <span className="truncate text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
              {t('question.needsInput', { defaultValue: 'Claude needs your input' })}
            </span>
            {q.header && (
              <Badge as="span" tone="neutral" className="vv-badge--compact flex-shrink-0 uppercase tracking-wider">
                {q.header}
              </Badge>
            )}
            {!isSingle && (
              <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-ink-faint">
                {currentStep + 1}/{total}
              </span>
            )}
          </div>

          {/* Progress (multi-question) */}
          {!isSingle && (
            <div className="mb-2 flex items-center gap-1">
              {questions.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentStep(i)}
                  aria-label={`${i + 1}/${total}`}
                  className={`h-1 rounded-full transition-all duration-move ${
                    i === currentStep ? 'w-5 bg-primary' : i < currentStep ? 'w-2.5 bg-primary/50' : 'w-2.5 bg-input'
                  }`}
                />
              ))}
            </div>
          )}

          <QuestionText text={q.question} />
          {multi && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('question.selectAll', { defaultValue: 'Select all that apply' })}
            </p>
          )}
        </div>

        {/* Options. Only the LIST scrolls past twelve rem; the "Other" row and its field sit in their
            own block below, so nothing a person types into is ever clipped. */}
        <div className="scrollbar-thin max-h-48 overflow-y-auto px-3 sm:px-4" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
          <div className="space-y-1.5">
            {q.options.map((opt, optIdx) => (
              <QuestionOptionRow
                key={opt.label}
                label={opt.label}
                description={opt.description}
                selected={selected.has(opt.label)}
                keyHint={String(optIdx + 1)}
                choice={multi ? 'checkbox' : 'radio'}
                onClick={() => toggleOption(currentStep, opt.label, multi)}
              />
            ))}
          </div>
        </div>

        {/* "Other" — outside the scroller above. Inside it, with three or more options, the field
            landed below the twelve-rem fold and was clipped against the footer's Submit button,
            hiding the lower half of what was being typed. Measured 2026-09-10. */}
        <div className="space-y-1.5 px-3 pb-3 pt-1.5 sm:px-4">
          <QuestionOptionRow
            label={t('question.other', { defaultValue: 'Other...' })}
            selected={isOtherOn}
            keyHint="0"
            dashed
            onClick={() => toggleOther(currentStep, multi)}
          />

          {isOtherOn && (
            <div className="relative pl-9">
              <Input
                ref={otherInputRef}
                type="text"
                value={otherTexts.get(currentStep) || ''}
                onChange={(e) => setOtherText(currentStep, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (isLast) handleSubmit();
                    else setCurrentStep(s => s + 1);
                  }
                  // Prevent container keydown from firing
                  e.stopPropagation();
                }}
                placeholder={t('question.otherPlaceholder', { defaultValue: 'Type your answer...' })}
                // pr-16 reserves the keycap's width on the right, so typed text never runs under the
                // "Enter" hint that sits inside the field.
                className="h-9 pr-16"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                Enter
              </kbd>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2 sm:px-4">
          <Button type="button" variant="ghost" size="sm" onClick={handleSkip} className="h-8 px-2 text-muted-foreground">
            {isSingle ? t('question.skip', { defaultValue: 'Skip' }) : t('question.skipAll', { defaultValue: 'Skip all' })}
            <span className={keyHintClass}>Esc</span>
          </Button>

          <div className="ml-auto flex items-center gap-1.5">
            {!isSingle && !isFirst && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setCurrentStep(s => s - 1)} className="h-8 px-2.5">
                <ChevronLeft aria-hidden />
                {t('question.back', { defaultValue: 'Back' })}
              </Button>
            )}

            {isLast ? (
              <Button
                type="button"
                size="sm"
                onClick={handleSubmit}
                disabled={!hasCurrentSelection && !Object.keys(buildAnswers()).length}
                className="h-8 px-3.5"
              >
                {t('question.submit', { defaultValue: 'Submit' })}
                <span className={keyHintClass}>Enter</span>
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setCurrentStep(s => s + 1)} className="h-8 px-3.5">
                {t('question.next', { defaultValue: 'Next' })}
                <span className={keyHintClass}>Enter</span>
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};
