import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { hearVoice } from '@/modules/companion/utils/astrolabeEar';
import { createAstrolabeInstrument } from '@/modules/companion/utils/astrolabeInstrument';
import { listeningTap } from '@/modules/companion/utils/listeningTap';
import { presenceWords } from '@/modules/companion/utils/presenceWords';
import type {
  AstrolabeFrameInput,
  AstrolabeTier,
  AstrolabeVoiceFrame,
  CompanionFaceLook,
  CompanionFaceSentences,
  CompanionFaceVoice,
  CompanionMaterial,
  CompanionPresence,
} from '@/shared/types';

type CompanionAvatarProps = {
  /** What she is doing: the instrument takes its state from `state`, the reticle its words and target from what she reads, and the walk arc from `walk`. */
  presence: CompanionPresence;
  /**
   * The page's voice, read by the instrument's loop each frame: `analyser()` for what her voice is doing (loudness, bands, pitch, onsets)
   * and `progress()` for the word she is on. Functions, never props that change, so a frame sixty times a second redraws nothing in React.
   * Null where no voice sounds (Settings' preview, an idle fixture).
   */
  voice: CompanionFaceVoice | null;
  /** The sentences she says, for the word plated on the dial's middle ring; null where there are none. */
  sentences: CompanionFaceSentences | null;
  /** Where the anchor she looks at lies from her; null when no look holds. The pointer slews toward it and locks. */
  look: CompanionFaceLook | null;
  /** The material she is drawn in (her `companionMaterial` preference); Mercury where none is given. */
  material?: CompanionMaterial;
  /** Her name as he set it; the default stands in while a page has not read it. */
  name?: string;
  /** The square she fills, in CSS pixels: it picks the tier (disc under 120 px, core under 260 px, the whole dial above). The canvases follow the square's own box frame by frame. */
  size: number;
};

/** Her fourteen presence words, as the four states the instrument knows. Reading, drafting and walking are her working: the instrument thinks. */
const INSTRUMENT_STATE: Record<CompanionPresence['state'], AstrolabeFrameInput['state']> = {
  idle: 'idle',
  cut: 'idle',
  loading: 'idle',
  asleep: 'idle',
  failed: 'idle',
  listening: 'listening',
  speaking: 'speaking',
  transcribing: 'thinking',
  thinking: 'thinking',
  waking: 'thinking',
  reading_session: 'thinking',
  reading_code: 'thinking',
  drafting: 'thinking',
  walking: 'thinking',
};

/** An idle face draws every other frame: its breath is slow enough that 30 frames a second loses nothing. */
const IDLE_FRAME_STRIDE = 2;

/** Where a subject (a chat, a file) sits on the dial: a stable bearing hashed from its name, so the pointer returns to the same place for the same thing. */
function bearingOf(subject: string): number {
  let hash = 2166136261;
  for (let i = 0; i < subject.length; i++) {
    hash ^= subject.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 3600) / 10;
}

/** What her voice is doing when the page's analyser is not there yet: the player's level alone, shaped into bands. */
function frameFromLevel(level: number, previous: AstrolabeVoiceFrame | null): AstrolabeVoiceFrame {
  const rms = Math.min(1, level * 3);
  const rising = previous !== null && rms - previous.rms > 0.25;
  return { rms, low: rms * 0.9, mid: rms * 0.7, high: rms * 0.4, f0: 0, voicing: 0, onsets: (previous?.onsets ?? 0) + (rising ? 1 : 0), onsetAmp: rising ? 0.7 : previous?.onsetAmp ?? 0 };
}

/**
 * Kaylee's face: the Astrolabe instrument — a chrome ferrofluid core, the breathing loop and, on the station, the armillary dial whose
 * pointer slews to what she is reading and locks. It replaces her photographed portrait. Used by this module's CompanionFace (the
 * provider-bound face that her button's disc and the station's head and portrait draw), by Settings' material card, and by the station
 * module's fixtures, which draw her on fixture presences; the face fills the square it is given and owns no chrome.
 *
 * TIERS by the square: under 120 px (her button) the loop round a 2D chrome core; under 260 px the raymarched WebGL core inside the loop;
 * above, the whole dial. The instrument owns its canvases (`astrolabeInstrument.ts`); this component feeds it once per animation frame
 * from refs, so her voice redraws nothing in React. A face off screen or in a hidden tab draws nothing.
 *
 * WHAT DRAWS WHAT. Speaking: her player's analyser drives the lobes, the spikes where the core extrudes, the shocks on hard consonants
 * and the loop's ripple. Listening: the ears' microphone tap draws the loop in. Thinking, reading, drafting and walking: the loop breaks
 * into turning dashes and the pointer sweeps, then locks on what she is looking at (the anchor his button points to, else a bearing
 * hashed from the chat or file she reads), with its words on the reticle's plate. A walk fills an accent arc round the loop. Failed draws
 * the loop in the warn colour; asleep dims and slows her.
 *
 * Her accessible name is her name and the state in words ("Kaylee, reading Bugfixes"), which a button around her may replace with a label
 * of its own; the canvases are for the eye alone.
 */
export function CompanionAvatar({ presence, voice, sentences, look, material = 'mercury', name, size }: CompanionAvatarProps) {
  const { t } = useTranslation();
  const her = name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  const tier: AstrolabeTier = size < 120 ? 'disc' : size < 260 ? 'core' : 'dial';
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // What the reticle's plate says while she works: short words, the chat or file it concerns.
  const label = (() => {
    const chat = presence.session?.name;
    const file = presence.files?.[0]?.split('/').pop();
    switch (presence.state) {
      case 'reading_code': return file ? t('companion.face.readingFile', { defaultValue: 'Reading {{file}}', file }) : t('companion.face.readingCode', { defaultValue: 'Reading code' });
      case 'reading_session': return chat ? t('companion.face.readingChat', { defaultValue: 'Reading {{chat}}', chat }) : t('companion.face.reading', { defaultValue: 'Reading' });
      case 'drafting': return t('companion.face.drafting', { defaultValue: 'Drafting' });
      case 'walking': return presence.walk ? t('companion.face.walk', { defaultValue: 'Item {{at}} of {{total}}', at: presence.walk.at, total: presence.walk.total }) : t('companion.face.walking', { defaultValue: 'Walkthrough' });
      default: return null;
    }
  })();

  // The latest of what the loop reads, kept off React's render path: a frame reads these, and each commit replaces them.
  const latest = useRef({ presence, voice, sentences, look, material, label });
  useLayoutEffect(() => {
    latest.current = { presence, voice, sentences, look, material, label };
  });

  useEffect(() => {
    const host = hostRef.current;
    const frameBox = frameRef.current;
    if (!host || !frameBox) return undefined;
    const instrument = createAstrolabeInstrument(host, tier, latest.current.material);
    let side = 0;
    const fitSquare = () => {
      const box = frameBox.getBoundingClientRect();
      const next = Math.max(16, Math.floor(Math.min(box.width, box.height)));
      if (next === side) return;
      side = next;
      host.style.width = `${side}px`;
      host.style.height = `${side}px`;
      instrument.resize(side);
    };
    fitSquare();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fitSquare);
    resizeObserver?.observe(frameBox);
    let visible = true;
    const intersectionObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
    });
    intersectionObserver?.observe(frameBox);

    let raf = 0;
    let last = performance.now();
    let frameCount = 0;
    let levelFrame: AstrolabeVoiceFrame | null = null;
    let reported = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      const current = latest.current;
      const state = INSTRUMENT_STATE[current.presence.state];
      frameCount += 1;
      if (state === 'idle' && frameCount % IDLE_FRAME_STRIDE !== 0) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      try {
        // Her voice: the player's tap while she speaks, the ears' microphone while she listens.
        let heard: AstrolabeVoiceFrame | null = null;
        if (state === 'speaking' && current.voice) {
          const analyser = current.voice.analyser();
          if (analyser) heard = hearVoice(analyser);
          else {
            levelFrame = frameFromLevel(current.voice.level(), levelFrame);
            heard = levelFrame;
          }
        } else if (state === 'listening') {
          const tap = listeningTap();
          if (tap) heard = hearVoice(tap);
        }
        // The word she is on: the sounding sentence's words at the place its audio has reached.
        let word: string | null = null;
        const playing = current.sentences?.playing;
        const progress = state === 'speaking' ? current.voice?.progress() : null;
        if (tier === 'dial' && playing && progress && progress.turnId === playing.turnId) {
          const words = playing.text.split(/\s+/).filter(Boolean);
          const at = progress.duration ? progress.elapsed / progress.duration : progress.elapsed / Math.max(1, words.length / 2.6);
          const index = Math.min(words.length - 1, Math.max(0, Math.floor(at * words.length)));
          word = words[index]?.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, '') || null;
        }
        const { look: anchor, presence: p } = current;
        const subject = p.session?.sessionId ?? p.files?.[0] ?? null;
        const working = p.state === 'reading_code' || p.state === 'reading_session' || p.state === 'drafting' || p.state === 'walking';
        const azimuth = anchor && (anchor.dx !== 0 || anchor.dy !== 0)
          ? (Math.atan2(-anchor.dy, anchor.dx) * 180) / Math.PI
          : working ? bearingOf(subject ?? p.state) : null;
        instrument.frame(dt, {
          state,
          voice: heard,
          azimuth,
          label: current.label,
          walk: p.walk,
          failed: p.state === 'failed',
          asleep: p.state === 'asleep',
          word,
          material: current.material,
        });
      } catch (error) {
        // One bad frame must not take the page down: report it once and keep drawing.
        if (!reported) {
          reported = true;
          console.error('[astrolabe] her face could not draw a frame', error);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      instrument.destroy();
    };
  }, [tier]);

  return (
    <div
      ref={frameRef}
      className="relative grid size-full place-items-center"
      data-state={presence.state}
      data-tier={tier}
      data-material={material}
      role="img"
      aria-label={presenceWords(t, her, presence)}
    >
      {/* The instrument's canvases go in here; React gives it no children. */}
      <div ref={hostRef} aria-hidden="true" className="relative" />
    </div>
  );
}
