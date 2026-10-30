import { bakeFace } from './face-bake.js';
import { FaceBakeRefusal, sentences } from './face-refusal.js';
import { recipeFrames } from './face-recipe.js';

/**
 * THE IN-PROCESS BAKE QUEUE: the faces wanted, made one at a time in the order they were asked for, each under the box-wide
 * lock `bakeFace` takes (`face-lock.ts`). A job is one PHOTO: several accounts that upload the same photo share its bake, and
 * the original's own bake (`forOriginal`) is a job that no account asked for. The queue moves on events only: a job is
 * started when it is asked for (if none is running) and when the running one settles; nothing here looks at a clock.
 *
 * The queue knows nothing of accounts' rows or pages. What a bake's progress and its end MEAN for them is the service's, told
 * through the two hooks.
 */

/** One photo's bake, queued or running. Consumed by `face.service.ts`, which reads its progress for the wire. */
export type BakeJob = {
  photoId: string;
  /** The accounts waiting on this photo's face. */
  accounts: Set<number>;
  /** Whether this is also the original's bake, which stays wanted though no account is waiting. */
  forOriginal: boolean;
  state: 'queued' | 'baking';
  done: number;
  total: number;
  abort: AbortController;
};

/** How a job ended: `made` (the face is published), `refused` (the sentence for his screen) or `ended` (aborted: the server is stopping, or nobody wants the face any more). */
export type BakeOutcome = { kind: 'made'; faceId: string } | { kind: 'refused'; sentence: string } | { kind: 'ended' };

/** What the service does with a job's life: `onProgress` after a state or a frame count changed, `onSettled` once when it ended (the job is no longer in the queue). */
export type BakeQueueHooks = {
  onProgress(job: BakeJob): void;
  onSettled(job: BakeJob, outcome: BakeOutcome): Promise<void>;
};

/** Consumed by `face.service.ts`, which makes one queue for the process. */
export function createBakeQueue(hooks: BakeQueueHooks) {
  const jobs: BakeJob[] = [];
  let running: Promise<void> | null = null;
  let stopped = false;

  /** A job that can still be joined: an aborted one is unwinding and will make nothing. */
  const liveJobOf = (photoId: string): BakeJob | undefined => jobs.find((job) => job.photoId === photoId && !job.abort.signal.aborted);

  const isWanted = (job: BakeJob): boolean => job.forOriginal || job.accounts.size > 0;

  function remove(job: BakeJob): void {
    const at = jobs.indexOf(job);
    if (at !== -1) jobs.splice(at, 1);
  }

  /** Takes the account off a job; a job nobody wants any more is dropped if it is waiting and aborted if it is baking. */
  function leave(job: BakeJob, userId: number): void {
    job.accounts.delete(userId);
    if (isWanted(job)) return;
    if (job.state === 'queued') remove(job);
    else job.abort.abort(new Error('nobody wants this face any more'));
  }

  function tell(job: BakeJob): void {
    try {
      hooks.onProgress(job);
    } catch (error) {
      console.error('[Companion] a face bake\'s progress could not be announced', { photoId: job.photoId, error });
    }
  }

  async function outcomeOf(job: BakeJob): Promise<BakeOutcome> {
    try {
      const { faceId } = await bakeFace({
        photoId: job.photoId,
        signal: job.abort.signal,
        onProgress(done, total) {
          job.done = done;
          job.total = total;
          tell(job);
        },
      });
      return { kind: 'made', faceId };
    } catch (error) {
      if (job.abort.signal.aborted) return { kind: 'ended' };
      if (error instanceof FaceBakeRefusal) return { kind: 'refused', sentence: error.message };
      console.error('[Companion] a face bake failed', { photoId: job.photoId, done: job.done, total: job.total, error });
      return { kind: 'refused', sentence: sentences.stopped(job.done, job.total) };
    }
  }

  async function run(job: BakeJob): Promise<void> {
    job.state = 'baking';
    tell(job);
    const outcome = await outcomeOf(job);
    remove(job);
    try {
      await hooks.onSettled(job, outcome);
    } catch (error) {
      console.error('[Companion] the end of a face bake could not be recorded', { photoId: job.photoId, outcome: outcome.kind, error });
    }
  }

  /** Starts the oldest waiting job when none is running. Called when a job is asked for and when the running one settles. */
  function start(): void {
    if (running || stopped) return;
    const next = jobs.find((job) => job.state === 'queued');
    if (!next) return;
    running = run(next).finally(() => {
      running = null;
      start();
    });
  }

  function join(photoId: string): BakeJob {
    const existing = liveJobOf(photoId);
    if (existing) return existing;
    const job: BakeJob = {
      photoId, accounts: new Set(), forOriginal: false, state: 'queued', done: 0, total: recipeFrames().length, abort: new AbortController(),
    };
    jobs.push(job);
    return job;
  }

  return {
    /** The original's face wanted: queued (or joined, if its photo is being made for an account) with no account behind it. */
    wantOriginal(photoId: string): void {
      if (stopped) return;
      join(photoId).forOriginal = true;
      start();
    },

    /** Makes `photoId`'s face what `userId` waits on: joins its job (or queues one) and leaves any other job the account was in, so a new upload replaces the pending one. */
    assign(userId: number, photoId: string): void {
      if (stopped) return;
      join(photoId).accounts.add(userId);
      for (const job of [...jobs]) if (job.photoId !== photoId) leave(job, userId);
      start();
    },

    /** The account waits on nothing: it leaves every job. */
    release(userId: number): void {
      for (const job of [...jobs]) leave(job, userId);
    },

    /** The job making `photoId`, queued or baking, or undefined. */
    jobOf: liveJobOf,

    /** The photos the queue holds, so a prune keeps their folders (the photo and its frame cache). */
    photoIds(): string[] {
      return jobs.map((job) => job.photoId);
    },

    /** Aborts the running bake (ComfyUI is stopped and the lock released), drops the waiting ones, and resolves once the running one has unwound. Nothing is started after it. */
    async stop(): Promise<void> {
      stopped = true;
      for (const job of [...jobs]) {
        if (job.state === 'queued') remove(job);
        else job.abort.abort(new Error('the server is stopping'));
      }
      await running;
    },
  };
}

/** The queue as the service holds it. Consumed by `face.service.ts`. */
export type BakeQueue = ReturnType<typeof createBakeQueue>;
