import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { CerberusDiagnosisStep, CerberusDiagnosisView } from '@/shared/cerberus-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';

/** What one diagnosis holds between reads and frames, for the diagnosis it names. */
type DiagnosisState = {
  diagnosisId: string;
  /** The diagnosis as center last answered it; null until a read answers. */
  read: CerberusDiagnosisView | null;
  /** The latest read did not answer, and no read has since. */
  failed: boolean;
  /** Every step known so far, by `n`, from the reads and the frames. */
  steps: CerberusDiagnosisStep[];
};

const blank = (diagnosisId: string): DiagnosisState => ({ diagnosisId, read: null, failed: false, steps: [] });

/** True when a body is a diagnosis: the fields no default can stand in for are there (`withDiagnosisFields` fills the rest). */
function isDiagnosis(body: unknown): body is CerberusDiagnosisView {
  if (body === null || typeof body !== 'object') return false;
  const candidate = body as { id?: unknown; node?: unknown; status?: unknown; steps?: unknown };
  return typeof candidate.id === 'string' && typeof candidate.node === 'string'
    && typeof candidate.status === 'string' && Array.isArray(candidate.steps);
}

/**
 * The diagnosis with every field the panel dereferences filled in where a server that drifted from this client left it
 * out: `evidence` as none, `proposal` and `run` as null. One missing field must not stand the error boundary in place of
 * the whole Cerberus tab, as the overview's own `withFixFields` keeps it from doing. The fields it leaves alone
 * (`summary`, `error`, `endedAt`, `oneOffExpiresAt`, `promotedTo`) the panel already reads as absent.
 */
function withDiagnosisFields(body: CerberusDiagnosisView): CerberusDiagnosisView {
  return {
    ...body,
    evidence: Array.isArray(body.evidence) ? body.evidence : [],
    proposal: body.proposal ?? null,
    run: body.run ?? null,
  };
}

/** True when a frame's `step` is a step: the three fields every row draws are there. */
function isStep(value: unknown): value is CerberusDiagnosisStep {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { n?: unknown; t?: unknown; text?: unknown };
  return typeof candidate.n === 'number' && typeof candidate.t === 'number' && typeof candidate.text === 'string';
}

/** The steps held plus the incoming ones it did not have, in order of `n`. A step arrives by a read and by a frame, and is kept once. */
function mergeSteps(held: CerberusDiagnosisStep[], incoming: CerberusDiagnosisStep[]): CerberusDiagnosisStep[] {
  const byNumber = new Map(held.map((step) => [step.n, step]));
  const before = byNumber.size;
  for (const step of incoming) if (!byNumber.has(step.n)) byNumber.set(step.n, step);
  return byNumber.size === before ? held : [...byNumber.values()].sort((a, b) => a.n - b.n);
}

/**
 * ONE DIAGNOSIS, read and kept live: the diagnosis as `GET /api/cerberus/diagnoses/:id` answers it, with its steps.
 *
 * THE STEPS come from two roads that meet by `n`. The read brings every step the diagnosis holds; each
 * `cerberus_diag_step` frame for this diagnosis brings the one just stored, and a step a frame and the read both
 * carry is kept once. A frame is a picture, so it is appended as it lands: that is how a running diagnosis's steps
 * arrive one by one. Everything else about the diagnosis (its status, summary, evidence, proposal, run) is only ever
 * what a read said, and the read is made again when a `cerberus_changed` hint names its check (the diagnosis ended,
 * its one-off ran, it was promoted), and on a reconnect.
 *
 * `diagnosis` is null until the first read answers, and `failed` says the read did not (a refusal, this app's own
 * network): `refresh` reads it again, and answers when that read has settled. A failed re-read keeps the last good answer on screen, as the other readers do.
 * Used by `DiagnosisPanel`, keyed by the diagnosis, so another one starts blank.
 */
export function useDiagnosis(diagnosisId: string): {
  diagnosis: CerberusDiagnosisView | null;
  failed: boolean;
  refresh: () => Promise<void>;
} {
  const { subscribe } = useWebSocket();

  // Everything the panel draws, for the diagnosis it was last given. Essential: the steps and the diagnosis arrive
  // by frames and reads at no fixed moment. It carries its diagnosis's id, so the answer for one the panel has left
  // is never drawn under the one it now shows.
  const [state, setState] = useState<DiagnosisState>(() => blank(diagnosisId));

  // The effect's own read, handed out so Try again can start one. A ref, since the read lives in the effect.
  const readRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    // Which read this is: only the newest one's answer is applied.
    let newestRead = 0;
    // `<node>/<check key>`, as the hint names it, once a read has said which check the diagnosis is on.
    let hintedCheck: string | null = null;

    const update = (change: (held: DiagnosisState) => DiagnosisState) => {
      if (alive) setState((held) => change(held.diagnosisId === diagnosisId ? held : blank(diagnosisId)));
    };

    const read = async () => {
      const ticket = ++newestRead;
      let answer: CerberusDiagnosisView | null = null;
      try {
        const response = await api.cerberus.diagnosis(diagnosisId);
        if (response.ok) {
          const body: unknown = await response.json();
          if (isDiagnosis(body)) answer = withDiagnosisFields(body);
        }
      } catch {
        // This app's own network, or a body that is not JSON: the same "did not answer" a refusal is.
      }
      if (!alive || ticket !== newestRead) return;
      if (answer === null) {
        update((held) => ({ ...held, failed: true }));
        return;
      }
      hintedCheck = `${answer.node}/${answer.check}`;
      const brought = answer.steps;
      update((held) => ({ ...held, read: answer, failed: false, steps: mergeSteps(held.steps, brought) }));
    };
    readRef.current = read;

    // Subscribed BEFORE the first read, as the other readers are: a frame that lands between the two is kept.
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'cerberus_diag_step') {
        if (event.diagId === diagnosisId && isStep(event.step)) {
          const incoming = [event.step];
          update((held) => ({ ...held, steps: mergeSteps(held.steps, incoming) }));
        }
      } else if (event.kind === 'cerberus_changed') {
        if (hintedCheck !== null && Array.isArray(event.checks) && event.checks.includes(hintedCheck)) void read();
      } else if (event.kind === 'websocket_reconnected') {
        void read();
      }
    });
    void read();

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [diagnosisId, subscribe]);

  const refresh = useCallback(() => readRef.current(), []);

  const current = state.diagnosisId === diagnosisId ? state : blank(diagnosisId);
  return {
    diagnosis: current.read === null ? null : { ...current.read, steps: current.steps },
    failed: current.failed,
    refresh,
  };
}
