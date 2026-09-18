import { Settings } from 'lucide-react';
import { useId, useState } from 'react';

import type { UniverseTweaksHandle } from '@/modules/universe/hooks/useUniverseTweaks';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';
import { TWEAK_RANGES } from '@/modules/universe/utils/universeTweaks';
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger, Field, Input, Select, Switch } from '@/shared/ui';

/**
 * THE ONE CONTROL SURFACE — a gear beside Recenter, opening a dialog with exactly one control per
 * tweak. No tweak has a second control anywhere: a chip on the strip for the one you touch most
 * is the pair that drifts the first time one is moved.
 *
 * THE RANGES ARE NOT RESTATED. A number's `min` and `max` come from `TWEAK_RANGES`, the table the
 * parser clamps against, so the control and the clamp cannot disagree. What this file owns is
 * what the table does not: the word for each tweak, the sentence saying what it does, the
 * keyboard step, and the group it is read in — Motion, Look, Decoration, Data, in that order.
 * One record, keyed by the tweak type, carries all of it, so a tweak added to the object is a
 * compile error here until it has its words and its group, and no tweak can be listed twice or
 * not at all.
 *
 * WHICH CONTROL IS READ OFF THE DOMAIN, not off a second list: a flag is a Switch, a word list is
 * a Select, a range is a number Input. The barrel has no slider and this build adds no component.
 *
 * EVERY VALUE ARRIVES AS A PROP. The hook that owns the object lives in the panel above, because
 * the canvas reads the same object through the hook's ref and there must be one of it.
 */
type TweakKey = keyof UniverseTweaks;

type GroupTitle = 'Motion' | 'Look' | 'Decoration' | 'Data';

type TweakWords = {
  group: GroupTitle;
  label: string;
  /** What the tweak does, in plain words: the Field's helper line. */
  helper: string;
  /** The number input's step. Meaningless for a switch or a select. */
  step?: number;
};

type UniverseTweaksPanelProps = {
  tweaks: UniverseTweaks;
  onChangeTweak: UniverseTweaksHandle['setTweak'];
  onResetTweaks: UniverseTweaksHandle['reset'];
};

/** One entry per tweak, enforced by the key type, written in the reading order of the groups. */
const WORDS: Readonly<Record<TweakKey, TweakWords>> = {
  orbit: { group: 'Motion', label: 'Orbit', helper: 'How fast stars circle their directory. Zero holds them still.', step: 0.05 },
  inclination: { group: 'Motion', label: 'Inclination', helper: 'How far the orbits tilt out of the plane.', step: 0.05 },
  precession: { group: 'Motion', label: 'Precession', helper: 'How much each orbit slowly turns on itself.', step: 0.05 },
  parallax: { group: 'Motion', label: 'Parallax', helper: 'How much the far stars slide against the near ones as you pan.', step: 0.05 },
  drift: { group: 'Motion', label: 'Drift', helper: 'Let the camera wander slowly while nothing is selected.' },
  pulseSpeed: { group: 'Motion', label: 'Pulse speed', helper: 'How fast an execution travels along its edges.', step: 0.1 },
  trails: { group: 'Motion', label: 'Trails', helper: 'Seconds of trail a moving star leaves behind. Zero draws none.', step: 1 },
  labels: { group: 'Look', label: 'Labels', helper: 'Which stars carry their name.' },
  edges: { group: 'Look', label: 'Edges', helper: 'Which relationships are drawn as lines.' },
  gravity: { group: 'Look', label: 'Gravity', helper: 'How tightly repos and directories pull their stars in.', step: 0.1 },
  distance: { group: 'Look', label: 'Distance', helper: 'How far everything sits from Claude, the centre.', step: 0.05 },
  milkyWay: { group: 'Look', label: 'Milky Way', helper: 'Paint a faint band of dust behind the sky.' },
  files: { group: 'Look', label: 'Files', helper: 'Which files are stars: code alone, or every tracked file.' },
  twinkle: { group: 'Look', label: 'Twinkle', helper: 'How much the stars flicker.', step: 0.05 },
  perspective: { group: 'Look', label: 'Perspective', helper: 'How much depth the sky has. Zero flattens it.', step: 0.05 },
  flow: { group: 'Look', label: 'Flow', helper: 'Draw executions as pulses travelling along the edges.' },
  // The one Look control that is not a look: `renderer` picks which of two paths draws the same
  // sky, and both take their numbers from one file — flipping it changes the cost, not the picture.
  renderer: { group: 'Look', label: 'Renderer', helper: 'Draw the stars on the GPU, or on the canvas as before.' },
  doppler: { group: 'Decoration', label: 'Doppler', helper: 'Tint a star bluer as it rises toward you and redder as it sinks away.', step: 0.05 },
  wobble: { group: 'Decoration', label: 'Wobble', helper: 'Let heavy stars tug the stars beside them.', step: 0.05 },
  lensing: { group: 'Decoration', label: 'Lensing', helper: 'Bend the light of stars passing behind the heaviest ones.', step: 0.05 },
  transits: { group: 'Decoration', label: 'Transits', helper: 'Darken a star for a moment as another passes in front of it.' },
  depthOfField: { group: 'Decoration', label: 'Depth of field', helper: 'Blur the stars far from the one you are looking at.', step: 0.05 },
  recencyBrightDays: { group: 'Data', label: 'Bright for', helper: 'Days since its last change a star burns at full brightness.', step: 1 },
  recencyDimDays: { group: 'Data', label: 'Dim after', helper: 'Days since its last change by which a star has dimmed to half.', step: 1 },
};

/** The keys in the table's order: `WORDS` is written in it, and a record keeps insertion order. */
const TWEAK_KEYS = Object.keys(WORDS) as TweakKey[];

/** The groups in reading order, each with the note its heading carries. The keys come from `WORDS`. */
const GROUPS: readonly { title: GroupTitle; note?: string }[] = [
  { title: 'Motion' },
  { title: 'Look' },
  { title: 'Decoration', note: 'Off by default. Each of these costs nothing while it is off.' },
  { title: 'Data', note: "Where a star's brightness curve bends." },
];

/** A select's words: the stored value is the key, the person reads the label. */
const OPTION_LABELS: Readonly<Record<string, string>> = {
  hubs: 'Hubs only',
  all: 'All',
  none: 'None',
  tree: 'Tree',
  import: 'Imports',
  cochange: 'Co-changes',
  code: 'Code only',
  webgl: 'GPU (WebGL)',
  canvas: 'Canvas',
};

type TweakNumberInputProps = {
  id: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (next: number) => void;
};

/**
 * A number typed in full before it is set. The setter clamps the moment it runs, so committing on
 * every keystroke would turn a "1" on its way to "15" into the minimum and an emptied field into
 * zero: the text belongs to the input until blur or Enter, and only a finite number leaves it.
 * The input is keyed on the committed value, so a value moved from outside — a reset, a clamp —
 * redraws the field with it, while a value left alone leaves the typed text alone.
 */
function TweakNumberInput({ id, value, min, max, step, onCommit }: TweakNumberInputProps) {
  const commit = (input: HTMLInputElement): void => {
    const next = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(next)) {
      input.value = String(value);
      return;
    }
    if (next !== value) onCommit(next);
  };

  return (
    <Input
      key={value}
      id={id}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      aria-describedby={`${id}-helper`}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
    />
  );
}

type TweakControlProps = {
  id: string;
  tweakKey: TweakKey;
  value: UniverseTweaks[TweakKey];
  onChange: UniverseTweaksHandle['setTweak'];
};

/** One tweak's row: the control its domain calls for, inside the Field that names and explains it. */
function TweakControl({ id, tweakKey, value, onChange }: TweakControlProps) {
  const words = WORDS[tweakKey];
  const domain = TWEAK_RANGES[tweakKey];

  if ('boolean' in domain && typeof value === 'boolean') {
    return (
      <Field label={words.label} helper={words.helper}>
        <Switch checked={value} onChange={(next) => onChange(tweakKey, next)} label={words.label} />
      </Field>
    );
  }

  if ('options' in domain && typeof value === 'string') {
    return (
      <Field label={words.label} helper={words.helper}>
        <Select
          ariaLabel={words.label}
          value={value}
          options={domain.options.map((option) => ({ value: option, label: OPTION_LABELS[option] ?? option }))}
          onChange={(next) => {
            // The Select speaks in strings; the tweak takes only its own words.
            const word = domain.options.find((option) => option === next);
            if (word !== undefined) onChange(tweakKey, word);
          }}
        />
      </Field>
    );
  }

  if ('min' in domain && typeof value === 'number') {
    return (
      <Field label={words.label} htmlFor={id} helper={`${words.helper} ${domain.min}–${domain.max}.`}>
        <TweakNumberInput
          id={id}
          value={value}
          min={domain.min}
          max={domain.max}
          step={words.step}
          onCommit={(next) => onChange(tweakKey, next)}
        />
      </Field>
    );
  }

  return null;
}

/** Used by UniversePanel, beside Recenter at the top right: the gear and the dialog it opens. */
export function UniverseTweaksPanel(props: UniverseTweaksPanelProps) {
  // Whether the dialog is showing. Not derivable: it is the reader's own act of opening it, and
  // the Done button has to be able to close what the gear opened.
  const [open, setOpen] = useState(false);
  const idBase = useId();

  // EVERY VALUE IS THE PANEL'S, AND EVERY CHANGE GOES BACK THROUGH IT. This file owns the words and
  // the arrangement of the controls, and nothing about the tweaks themselves: the object is the
  // hook's — the canvas reads the same one through that hook's ref — and `onChangeTweak` IS its
  // `setTweak`, so every value a control offers passes `parseTweaks` and is clamped before it is
  // either stored or drawn. A number typed to 900 is 3 by the time it is anywhere.
  const tweaks: UniverseTweaks = props.tweaks;
  const onChangeTweak: UniverseTweaksPanelProps['onChangeTweak'] = props.onChangeTweak;
  const onResetTweaks: UniverseTweaksPanelProps['onResetTweaks'] = props.onResetTweaks;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Tweaks" title="Tweaks">
          <Settings aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[88vh] w-[calc(100%-2rem)] flex-col p-0" aria-labelledby={`${idBase}-title`}>
        <div className="flex items-baseline justify-between gap-3 px-6 pt-5">
          <DialogTitle id={`${idBase}-title`} className="not-sr-only font-serif text-2xl leading-tight text-foreground">
            Tweaks
          </DialogTitle>
          <span className="text-xs text-ink-faint">Kept in this browser only</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {GROUPS.map((group) => (
            <fieldset key={group.title} className="mb-6 last:mb-0">
              <legend className="text-xs uppercase tracking-[0.14em] text-ink-faint">{group.title}</legend>
              {group.note !== undefined && <p className="mt-1 text-[13px] text-muted-foreground">{group.note}</p>}
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {TWEAK_KEYS.filter((key) => WORDS[key].group === group.title).map((key) => (
                  <TweakControl
                    key={key}
                    id={`${idBase}-${key}`}
                    tweakKey={key}
                    value={tweaks[key]}
                    onChange={onChangeTweak}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onResetTweaks}>
            Reset to defaults
          </Button>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
