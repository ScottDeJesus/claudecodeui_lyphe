import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import '@/modules/companion/CompanionAvatar.css';
import { presenceWords } from '@/modules/companion/utils/presenceWords';
import type { CompanionPresence } from '@/shared/types';

type CompanionAvatarProps = {
  /** What she is doing: the face takes its look from `state` and the walk ring from `walk`; the chat and files give the accessible name its subject. */
  presence: CompanionPresence;
  /**
   * Her own voice's level, 0..1 (the page player's `level()`). Read only by the mouth loop while she is speaking, so it
   * is a function and never a prop that changes: a level pushed through React would redraw the face sixty times a second.
   */
  level: () => number;
  /** The square the face fills, in pixels. She owns no chrome: the disc, the dock and the motion around her are the button's. */
  size: number;
  /** Her name as he set it; the default stands in while a page has not read it. */
  name?: string;
};

/** The walk ring's radius in the 100-unit square: it runs just outside the head (radius 37) and inside the square's edge, whose stroke the stylesheet sets. */
const RING_RADIUS = 45;

/**
 * Kaylee's face, "the light that guides this project": a round, warm, bright face drawn in code (SVG and CSS on Verve's
 * tokens, no image), so it follows the theme, scales without blur and moves cheaply. Used by this module's button, which
 * draws her in its floating disc; the face fills a square of `size` pixels and owns no chrome.
 *
 * ONE SVG, KEYED BY `data-state`. The head, cheeks, eyes and mouth are always there; each state turns on its own accent
 * (her ears pulsing, three dots turning, a page, a pencil, the walk ring) and sets the pose of the face; the stylesheet
 * beside this file holds every look and every keyframe. A state's LOOK is its still frame and its MOVEMENT is added only
 * under `prefers-reduced-motion: no-preference`, so reduced motion keeps each look and drops the movement.
 *
 * WHICH STATE DRAWS WHICH LOOK. `data-state` carries the presence state as it is, fourteen words. Ten have a look of their
 * own (idle, listening, transcribing, thinking, speaking, reading_session, reading_code, drafting, walking, cut) and `failed`
 * is the eleventh: she is still (no breath, no blink loop, in either motion mode), her eyes level and soft, her mouth a level
 * line, and the status line's amber, `--warn-dot`, a ring that stands clear of the orb. The other three share a look:
 * `asleep` and `loading` draw idle's, and `waking` draws thinking's (a word is on its way).
 *
 * THE MOUTH is one CSS variable, `--kaylee-mouth`, 0 (closed smile) to 1 (open wide): the open mouth scales on it, so
 * whatever writes the variable moves her lips and nothing in React redraws. Only a speaking face hears it: the open mouth is
 * off in every other state, so a value left in the variable never opens the mouth of a face that has stopped. She walks a result on a ring at
 * `walk.at / walk.total` whose numbers show while the face is hovered or its button focused.
 *
 * Her accessible name is her name and the state in words ("Kaylee, reading Bugfixes"), which a button around her may
 * replace with a label of its own.
 */
export function CompanionAvatar({ presence, level, size, name }: CompanionAvatarProps) {
  const { t } = useTranslation();
  // One id per face: a page holds several (the button, the panel, the fixtures) and a gradient or clip reached by a shared
  // id would be the first face's, or nothing once that one unmounts.
  const uid = useId();
  const skinId = `${uid}-skin`;
  const haloId = `${uid}-halo`;
  const mouthId = `${uid}-mouth`;
  const her = name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  const { state, walk } = presence;
  const count = walk ? `${walk.at}/${walk.total}` : '';
  // The numbers shrink a little and their pill widens with the digits ("12/40"), so it stays inside the head's width. They
  // stop shrinking at 12 units (a walk of a thousand items), and the digits of a longer walk are squeezed to fit the pill.
  const countSize = Math.max(12, 22 - Math.max(0, count.length - 3) * 3);
  const countNatural = count.length * countSize * 0.64;
  const countWidth = Math.min(68, countNatural + 14);
  const countSqueezed = countNatural + 14 > countWidth;
  // A walk with no items has nowhere to fill: the track alone. At 0 of n ("set up, not begun") the arc is empty too.
  const filled = walk && walk.total > 0 ? Math.min(1, Math.max(0, walk.at / walk.total)) : 0;

  // The face's own element, which the mouth loop writes the variable onto: the CSS reads it there, and nothing in React redraws.
  const faceRef = useRef<SVGSVGElement>(null);
  const speaking = state === 'speaking';

  // THE MOUTH LOOP runs only while she is speaking: a frame is scheduled by the one before it, so a face that is not
  // speaking schedules none, and the cleanup both stops the loop and hands the variable back to the stylesheet's 0. `level`
  // is the provider's one function for the page's life, so the loop is not restarted mid-sentence, and it already answers
  // 0..1 (the player clamps it), which is the variable's range: measured, a spoken sentence opens the mouth to 0.4 at its peaks.
  useEffect(() => {
    const face = faceRef.current;
    if (!speaking || !face) return undefined;
    let frame = 0;
    const follow = () => {
      face.style.setProperty('--kaylee-mouth', String(level()));
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      face.style.removeProperty('--kaylee-mouth');
    };
  }, [speaking, level]);

  return (
    <svg
      ref={faceRef}
      className="kaylee"
      data-state={state}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={presenceWords(t, her, presence)}
    >
      <defs>
        <radialGradient id={skinId} cx="38%" cy="32%" r="78%">
          <stop offset="0" className="kaylee__skin-hi" />
          <stop offset="0.7" className="kaylee__skin" />
          <stop offset="1" className="kaylee__skin-lo" />
        </radialGradient>
        <radialGradient id={haloId}>
          <stop offset="0.7" className="kaylee__glow-in" />
          <stop offset="1" className="kaylee__glow-out" />
        </radialGradient>
        {/* The open mouth hangs from the lip: everything above the smile is cut away, so the lip stays a curve at any opening. */}
        <clipPath id={mouthId}>
          <path d="M 35 59 Q 50 71 65 59 L 70 92 L 30 92 Z" />
        </clipPath>
      </defs>

      <circle className="kaylee__halo" cx="50" cy="50" r="49" fill={`url(#${haloId})`} />

      {/* Listening: sound arriving at her ears, a pair of arcs a side, pulsing in toward her. */}
      <g className="kaylee__ears">
        <path className="kaylee__ear kaylee__ear--near" d="M 11 39 Q 7 50 11 61" />
        <path className="kaylee__ear kaylee__ear--far" d="M 6 33 Q 1 50 6 67" />
        <path className="kaylee__ear kaylee__ear--near kaylee__ear--right" d="M 89 39 Q 93 50 89 61" />
        <path className="kaylee__ear kaylee__ear--far kaylee__ear--right" d="M 94 33 Q 99 50 94 67" />
      </g>

      <g className="kaylee__body">
        <circle className="kaylee__head" cx="50" cy="50" r="37" fill={`url(#${skinId})`} />
        <path className="kaylee__sheen" d="M 24 36 Q 29 26 39 22" />
        <ellipse className="kaylee__cheek" cx="28.5" cy="58" rx="6" ry="3.8" />
        <ellipse className="kaylee__cheek" cx="71.5" cy="58" rx="6" ry="3.8" />

        <path className="kaylee__brow kaylee__brow--left" d="M 30 33 Q 37 29.5 44 33" />
        <path className="kaylee__brow kaylee__brow--right" d="M 56 33 Q 63 29.5 70 33" />

        <g className="kaylee__eyes">
          <g className="kaylee__eye kaylee__eye--left">
            <ellipse className="kaylee__pupil" cx="37" cy="45" rx="5" ry="6.4" />
            <circle className="kaylee__glint" cx="38.9" cy="42.6" r="1.9" />
          </g>
          <g className="kaylee__eye kaylee__eye--right">
            <ellipse className="kaylee__pupil" cx="63" cy="45" rx="5" ry="6.4" />
            <circle className="kaylee__glint" cx="64.9" cy="42.6" r="1.9" />
          </g>
        </g>

        <g className="kaylee__mouth">
          <g clipPath={`url(#${mouthId})`}>
            <g className="kaylee__mouth-open">
              <ellipse className="kaylee__throat" cx="50" cy="59" rx="15" ry="18" />
              <ellipse className="kaylee__tongue" cx="50" cy="73" rx="8" ry="6" />
            </g>
          </g>
          <path className="kaylee__lip" d="M 35 59 Q 50 71 65 59" />
          <ellipse className="kaylee__surprise" cx="50" cy="63" rx="5" ry="6" />
        </g>
      </g>

      {/* Transcribing and thinking: three dots turning around her, each smaller than the one before it. */}
      <g className="kaylee__dots">
        <circle className="kaylee__dot" cx="50" cy="6" r="6.4" />
        <circle className="kaylee__dot" cx="88.1" cy="72" r="5" />
        <circle className="kaylee__dot" cx="11.9" cy="72" r="3.8" />
      </g>

      {/* Reading a chat: a speech bubble held at her side. */}
      <g className="kaylee__bubble">
        <path className="kaylee__paper" d="M 63 60 H 86 a 4 4 0 0 1 4 4 V 78 a 4 4 0 0 1 -4 4 H 77 L 70 90 V 82 H 63 a 4 4 0 0 1 -4 -4 V 64 a 4 4 0 0 1 4 -4 Z" />
        <path className="kaylee__line" d="M 64 67.5 H 85" />
        <path className="kaylee__line" d="M 64 74 H 78" />
      </g>

      {/* Reading code: a small page, its lines indented like code, held where her eyes can sweep across it. */}
      <g className="kaylee__page">
        <rect className="kaylee__paper" x="60" y="56" width="29" height="34" rx="4" />
        <path className="kaylee__line kaylee__line--a" d="M 65 64 H 78" />
        <path className="kaylee__line kaylee__line--b" d="M 69 70 H 83" />
        <path className="kaylee__line kaylee__line--c" d="M 69 76 H 76" />
        <path className="kaylee__line kaylee__line--a" d="M 65 82 H 80" />
      </g>

      {/* Drafting: a pencil writing a stroke; the stroke is drawn from its left end and the pencil rides its tip. */}
      <g className="kaylee__draft">
        <path className="kaylee__stroke" d="M 36 92 q 5 -6 10 0 t 10 0 t 10 0" pathLength="1" />
        <g className="kaylee__pencil">
          <path className="kaylee__pencil-body" d="M 0 0 L 5 -4.2 L 25 -24.5 L 30 -19.8 L 9.6 0.6 Z" />
          <path className="kaylee__pencil-tip" d="M 0 0 L 5 -4.2 L 9.6 0.6 Z" />
          <path className="kaylee__pencil-end" d="M 25 -24.5 L 27.4 -27 L 32.4 -22.2 L 30 -19.8 Z" />
        </g>
      </g>

      {/* Walking a result: a ring around her face, filled to item k of n. */}
      <g className="kaylee__walk">
        <circle className="kaylee__track" cx="50" cy="50" r={RING_RADIUS} />
        {filled > 0 && (
          <circle
            className="kaylee__progress"
            cx="50"
            cy="50"
            r={RING_RADIUS}
            pathLength="1"
            strokeDasharray={`${filled} 1`}
          />
        )}
        {walk && (
          <g className="kaylee__count">
            <rect x={50 - countWidth / 2} y="56" width={countWidth} height="30" rx="15" />
            <text
              x="50"
              y="71.5"
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fontSize: countSize }}
              textLength={countSqueezed ? countWidth - 14 : undefined}
              lengthAdjust={countSqueezed ? 'spacingAndGlyphs' : undefined}
            >
              {count}
            </text>
          </g>
        )}
      </g>
    </svg>
  );
}
