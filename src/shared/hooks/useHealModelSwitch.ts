import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

type HealModelResponse = { model?: 'deepseek' | 'claude' };

/**
 * Where the heal's model switch stands: ONE of the two models, and nothing else. The file names a
 * side in every state — an absent `heal_model.flag` is `deepseek` — so there is no third position for
 * a surface to draw and no caption to explain one.
 */
export type HealModelPosition = 'deepseek' | 'claude';

type HealModelSwitch = {
  /** The switch as the server last read it off disk, or `null` while no read has succeeded. */
  position: HealModelPosition | null;
  /** True once a read has failed: the position is unknown, which is not the same as either model. */
  unreadable: boolean;
  /** True while a write is in flight, so a caller can refuse a second flip until the server answers. */
  saving: boolean;
  /** Name the side the heal runs on. The server writes that word out and answers what it read back. */
  setModel: (next: HealModelPosition) => Promise<void>;
  /** Ask the server again — the way out of an unreadable switch, and the only press a control with
   * no position can honour. */
  refresh: () => Promise<void>;
};

/**
 * The switch's position as the server reads it off disk, or `null` when it could not be read.
 *
 * `null` here is not a model: it is the question going unanswered (a timeout, a 502, an expired
 * token), and it is what keeps the control from drawing a side that was never read. The server's own
 * answer is always one of the two words — an absent file is `deepseek` on both sides of the contract —
 * so a body without a word is that same unanswered question, never a state of the file.
 *
 * A transport call that RETURNS the value rather than setting state: every caller here needs the same
 * read, and a component-scoped setter shared between an effect and an event handler is the shape that
 * reads as a synchronous setState-in-effect.
 */
async function readSwitch(): Promise<HealModelPosition | null> {
  try {
    const response = await api.settings.healModel();
    const body = (await response.json()) as HealModelResponse;
    // An error ANSWER is not a position. The API's own envelope for a restart, a proxy's 502 or an
    // expired token's 401 is `{success:false,error:{…}}`, which `.json()` parses happily — and a
    // missing field read as a model would draw a side out of nothing, with nothing thrown so the
    // unknown state is never reached. Only the two words are an answer.
    if (!response.ok) return null;
    return body.model === 'deepseek' || body.model === 'claude' ? body.model : null;
  } catch (error) {
    console.error('Error loading the heal model switch:', error);
    return null;
  }
}

/** The write, returning the position the server read back off the file, or `null` if it failed. */
async function writeSwitch(next: HealModelPosition): Promise<HealModelPosition | null> {
  try {
    const response = await api.settings.saveHealModel(next);
    const body = (await response.json()) as HealModelResponse;
    // A refused write is not a position either, and this is the direction that PERSISTS the invented
    // side: read as the word asked for, a 500 on the PUT would draw a model the file never went to and
    // the next press would write off it. Null here is what reaches `forgetPosition`.
    if (!response.ok) return null;
    return body.model === 'deepseek' || body.model === 'claude' ? body.model : null;
  } catch (error) {
    console.error('Error saving the heal model switch:', error);
    return null;
  }
}

/**
 * Every surface showing the switch right now, each entry a way of being told a position. Two
 * surfaces compose this hook — the Heal tab's header strip and the Settings → Agents row — so a flip
 * made on one tells the other, and neither shows a side the other has left.
 */
const readers = new Set<(position: HealModelPosition | null, forget?: boolean) => void>();

/**
 * The last position the server gave back — the newest thing anyone here knows. A reader that MOUNTS
 * takes it at once, before the answer it is asking for can arrive, so a surface opening while a
 * question is already out does not sit unknown for the whole length of that question.
 */
let known: HealModelPosition | null = null;

/**
 * How many authoritative positions have been established: one as a write is issued, one when its
 * answer is published. MODULE level, and that is the whole of it — the flag is ONE file, so the order
 * of answers about it is ONE order. This is not tidiness: on the neighbouring DeepSeek switch a read
 * issued before a flip and landing after it drew the side the file had already left, measured as seven
 * consecutive samples on screen while the file read the opposite. One clock for every reader.
 */
let epoch = 0;

/** A question is out to the server. */
let inFlight = false;
/** Another ask arrived while that question was out; the newer one, asked for real once it lands. */
let waiting = false;
/** A write is crossing the wire — module-wide for the reason `epoch` is. */
let writing = false;

/** Hand a position to every surface on screen. */
function deliver(position: HealModelPosition | null) {
  // `null` is "could not ask", which does not un-know the last position the server gave: it is the
  // reader that forgets, and now there is one of them instead of a copy each.
  if (position !== null) known = position;
  for (const reader of readers) reader(position);
}

/** Publish the position the server gave back, and retire every question asked before it existed. */
function announce(position: HealModelPosition) {
  epoch += 1;
  waiting = false;
  deliver(position);
}

/**
 * Tell every surface the position is UNKNOWN, and mean it: what is on screen was never read off the
 * file, so it is dropped rather than kept. A model nobody read is not a model, and the one thing this
 * control must never do is draw a side it invented.
 */
function forgetPosition() {
  epoch += 1;
  waiting = false;
  known = null;
  for (const reader of readers) reader(null, true);
}

/** How long to wait before asking a second time: a lost packet is far likelier than a missing file,
 * and the cost of not retrying is a control with no position, which cannot be used at all. */
const READ_RETRY_MS = 1200;

/**
 * Ask the server where the switch is, and hand the answer to every surface.
 *
 * ONE read at a time for the whole tab rather than one per instance: two surfaces asking the same
 * question of the same file is a second request that cannot say anything the first will not, and it is
 * what puts two answers in flight whose arrival order decides the position.
 */
async function ask(): Promise<void> {
  if (inFlight) {
    waiting = true;
    return;
  }

  inFlight = true;
  do {
    waiting = false;
    // The clock as it stood when this question was put: an answer is worth drawing only if nothing
    // authoritative has been established since.
    const at = epoch;

    let position = await readSwitch();
    if (position === null) {
      await new Promise((resolve) => setTimeout(resolve, READ_RETRY_MS));
      position = await readSwitch();
    }

    // Silence is the answer here: a question put before the switch moved has no business drawing the
    // side it was on, and an answer also holds back while a newer question is already queued.
    if (at === epoch && !waiting) deliver(position);
  } while (waiting);

  inFlight = false;
}

/**
 * Write the switch, and publish the position the server read back off the file.
 *
 * Nothing here touches a component: the position reaches every surface, the writer's included,
 * through `announce`, so there is one delivery path and no second setState able to disagree with it.
 */
async function write(next: HealModelPosition): Promise<void> {
  // Dropped rather than queued, module-wide because the file is one file: two flips racing onto it
  // would leave whichever answer lands last to decide.
  if (writing) return;
  writing = true;
  // Every read issued before this point is older than the write about to land, and is retired — done
  // as the write is ISSUED, so a read landing mid-write cannot draw the side the file is leaving.
  epoch += 1;

  const settled = await writeSwitch(next);
  // Re-READ on failure, never the opposite word. Inverting is a guess about a file this process does
  // not own: the switch is host-wide, so a failed write can perfectly well land on a file another
  // operator just set to `next` anyway. And when that question goes unanswered too, the positions on
  // screen are RETRACTED rather than kept — there is nothing left here that was ever read off the
  // file, and the one thing this control must never do is draw a side it invented.
  const truth = settled !== null ? settled : await readSwitch();
  if (truth !== null) announce(truth);
  else forgetPosition();

  writing = false;
}

/**
 * The one reader and writer of the heal reflex's MODEL switch in `src/`. It is the switch the operator
 * asked for in as many words ("On the Heal tab can we have its own separate DeepSeek and Claude
 * toggle, same as session chat here?") and then made independent of the chat's ("if I press that
 * button I don't want flash to turn off for my chat"), so that leftover Claude usage at the end of a
 * week can go to heals that would otherwise wait behind a DeepSeek cap.
 *
 * IT IS NOT THE CHAT'S SWITCH, and it must never become it: the chat composer's chip writes
 * `deepseek_flash.flag` through `useDeepSeekFlashSwitch`, this hook writes `heal_model.flag`, and the
 * worker reads this one only for its own chain. Two files, two hooks, two clocks — a heal turned onto
 * Claude moves no session's builds, and a session turned onto DeepSeek moves no heal. NEITHER SIDE IS
 * A DEFAULT FOR THE OTHER: with `heal_model.flag` absent the heal runs on `deepseek`, whatever the
 * composer's switch says.
 *
 * The position is NOT a client preference and so is not `readUserPreference`: it is a file on this
 * host that the reflex's worker re-parses at every ending, which is why every read here is a request
 * to the server rather than a value the browser already holds.
 */
export function useHealModelSwitch(): HealModelSwitch {
  // The switch lives on disk in another process's world; until it answers there is no honest position
  // to draw, and `null` is what keeps the control from flickering through a wrong one.
  const [position, setPosition] = useState<HealModelPosition | null>(null);
  // Set when a read comes back with nothing, so the control can say the position is unknown rather
  // than drawing the one it does not have. Cleared by the first read that answers.
  const [unreadable, setUnreadable] = useState(false);
  // Held only while a write is in flight, so this surface refuses its own repeated press. The guard
  // that actually stops a second write is the module's `writing`; this is what the button draws.
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    const reader = (answer: HealModelPosition | null, forget = false) => {
      if (!live) return;
      if (forget) {
        // Not "keep the last position and admit it is unread": the last position here was drawn by
        // this very press and never confirmed against the file. Dropped, so the surface shows the
        // unknown state instead of the side it guessed.
        setPosition(null);
        setUnreadable(true);
        return;
      }
      if (answer === null) {
        setUnreadable(true);
        return;
      }
      setUnreadable(false);
      setPosition(answer);
    };
    readers.add(reader);
    // Drawn at once, before the ask below can be answered — see `known`.
    if (known !== null) reader(known);
    void ask();

    // Coming back to the page is the one moment the position can have moved under a surface that is
    // already mounted — the operator flips it from their phone. Skipped while a write is in flight:
    // that write's own answer is already on its way. `visibilitychange` is listened for beside `focus`
    // because iOS Safari fires no reliable blur/focus on an app switch.
    const onFocus = () => { if (!writing) void ask(); };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      live = false;
      // Dropped, so an answer arriving after this surface is gone cannot land on the run that replaced
      // it. The ask itself is deliberately NOT cancelled: the question was put to the server, and
      // `ask` still owes its answer to every reader still on screen.
      readers.delete(reader);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const refresh = useCallback(async () => {
    await ask();
  }, []);

  const setModel = useCallback(async (next: HealModelPosition) => {
    if (writing) return;
    setSaving(true);
    // Optimistic, then corrected: the server answers with what it read back off the file, so a write
    // that lands differently than asked still ends with the control telling the truth.
    setPosition(next);
    setUnreadable(false);
    await write(next);
    setSaving(false);
  }, []);

  return { position, unreadable, saving, setModel, refresh };
}
