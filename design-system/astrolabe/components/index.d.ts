import type * as React from 'react';

/** The instrument's states. `bridging` is the gap between two sentences; `playing` is a file being analysed. */
/** What the companion is doing. The Core takes a different physical form for each; `bridging` looks like `thinking`. */
export type VoiceState = 'idle' | 'thinking' | 'bridging' | 'speaking' | 'listening' | 'reading' | 'writing';
/** The core's four materials. A subtree takes one with the class `ast-persona-mercury`, `ast-persona-tube`, `ast-persona-wire` or `ast-persona-plasma`. */
export type Material = 'mercury' | 'tube' | 'wire' | 'plasma';
export type IconName = 'play' | 'stop' | 'mic' | 'plus' | 'upload' | 'chevron' | 'back' | 'close' | 'trash' | 'send' | 'pin' | 'chat' | 'speaker' | 'speaker-off' | 'ear' | 'ear-off' | 'panel' | 'lines' | 'menu' | 'settings' | 'terminal' | 'file' | 'pencil' | 'search' | 'globe' | 'tool' | 'thought' | 'question' | 'copy' | 'check' | 'more';
export type Option = string | { value: string; label?: React.ReactNode; disabled?: boolean };

/** Per-frame voice features. All bands are normalised 0–1; counters only ever increase. */
export interface SignalFeatures {
  rms: number; low: number; mid: number; high: number;
  /** Fundamental in Hz, 0 when unvoiced. */
  f0: number; voicing: number;
  /** Onset (hard consonant) count and the strength of the latest one (0.25–1). */
  onsets: number; onsetAmp: number;
  /** Word and phoneme-unit counts, and the current unit/word text when known. */
  words: number; units: number; unit?: string; word?: string; wordIndex?: number;
}
export type SignalReader = (() => SignalFeatures) & { words?: string[]; text?: string; demo?: boolean; state?: () => VoiceState };
/** An AnalyserNode (live analysis), a function returning features, a static partial object, or 'demo'. */
export type SignalSource = AnalyserNode | SignalReader | Partial<SignalFeatures> | 'demo';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` for the one action the view exists for (Speak). `danger` for an act that destroys (Remove). Default: quiet. */
  variant?: 'primary' | 'default' | 'danger';
  /** `small` is the same button at the height of a row, for an act that belongs to one line of a list. */
  size?: 'small';
  /** The action is running: accent edge, accent-tint fill, accent label. */
  active?: boolean;
  icon?: IconName;
  /** The mark says it: no word shown. The word stays as the title and the name for assistive tech. */
  iconOnly?: boolean;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface ToggleButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  pressed: boolean;
  onPressedChange?: (next: boolean) => void;
  icon?: IconName;
  iconOnly?: boolean;
}
export declare function ToggleButton(props: ToggleButtonProps): React.ReactElement;

export interface FileButtonProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  accept?: string;
  multiple?: boolean;
  /** One File, or File[] with `multiple`. */
  onFile?: (file: File | File[]) => void;
  icon?: IconName;
  iconOnly?: boolean;
  children?: React.ReactNode;
}
export declare function FileButton(props: FileButtonProps): React.ReactElement;

export interface SegmentedControlProps {
  /** Accessible name of the group, e.g. "Core material". */
  label: string;
  options: Option[];
  value: string;
  /** Fires on a press, or when a dragged plate is let go over another segment. */
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
/** The plate can be pressed to, or dragged and dropped on, a segment. */
export declare function SegmentedControl(props: SegmentedControlProps): React.ReactElement;

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Accessible label; visually hidden unless `showLabel`. */
  label: string;
  showLabel?: boolean;
  onEnter?: (value: string, event: React.KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  /** Drawn as the 78px uppercase column. Omit for a bare select (then pass aria-label). */
  label?: string;
  options: Option[];
  value?: string;
  onChange?: (value: string, event: React.ChangeEvent<HTMLSelectElement>) => void;
}
export declare function Select(props: SelectProps): React.ReactElement;

export interface DockProps extends React.HTMLAttributes<HTMLDivElement> {}
export declare function Dock(props: DockProps): React.ReactElement;

export interface IconProps { name: IconName; size?: number; title?: string; className?: string; style?: React.CSSProperties }
export declare function Icon(props: IconProps): React.ReactElement;

export interface KeyValueListProps { items: Array<[React.ReactNode, React.ReactNode] | { label: React.ReactNode; value: React.ReactNode }>; className?: string; style?: React.CSSProperties }
export declare function KeyValueList(props: KeyValueListProps): React.ReactElement;

export interface StatusProps extends React.HTMLAttributes<HTMLSpanElement> {
  state?: VoiceState | 'playing';
  label?: React.ReactNode;
  /** Default true. Lock words drop the dot. */
  dot?: boolean;
  tone?: 'accent' | 'quiet';
}
export declare function Status(props: StatusProps): React.ReactElement;

export interface ReadoutProps {
  value?: number | string | null;
  unit?: string;
  note?: React.ReactNode;
  source?: React.ReactNode;
  /** 0–1; sets the weight 200–520. */
  voicing?: number;
  decimals?: number;
  align?: 'start' | 'end';
  /** Live: reads f0, note and voicing from the signal. */
  signal?: SignalSource;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Readout(props: ReadoutProps): React.ReactElement;

export interface BufferGaugeProps { value?: number; filled?: number; cells?: number; caption?: React.ReactNode; label?: string; className?: string; style?: React.CSSProperties }
export declare function BufferGauge(props: BufferGaugeProps): React.ReactElement;

export interface ReadoutRowItem { label?: React.ReactNode; value?: React.ReactNode; tone?: 'muted' | 'accent' }
export interface ReadoutRowProps { items: Array<ReadoutRowItem | [React.ReactNode, React.ReactNode]>; align?: 'start' | 'end'; spacing?: 'wide'; className?: string; style?: React.CSSProperties }
export declare function ReadoutRow(props: ReadoutRowProps): React.ReactElement;

export interface TranscriptProps {
  words: string[] | string;
  /** Index being spoken: -1 before speech, words.length when done. */
  active?: number;
  /** The live word's weight follows the signal's RMS. */
  live?: boolean;
  signal?: SignalSource;
  /** Precomputed weights per word (300–780). */
  weights?: number[];
  label?: React.ReactNode;
  hint?: React.ReactNode;
  history?: number;
  lookahead?: number;
  lines?: number;
  ariaLive?: 'off' | 'polite';
  className?: string;
  style?: React.CSSProperties;
}
export declare function Transcript(props: TranscriptProps): React.ReactElement;

export interface NoticeProps extends React.HTMLAttributes<HTMLParagraphElement> {}
export declare function Notice(props: NoticeProps): React.ReactElement;

interface SignalCanvasProps { /** `'dispatching'` is accepted as `'writing'`. */ state?: VoiceState | 'dispatching'; signal?: SignalSource; label?: string; className?: string; style?: React.CSSProperties }

export interface CoreProps extends SignalCanvasProps {
  /** Overrides the material class of the subtree it sits in. */
  material?: Material;
  /** The direction of what it reads from or writes to, in degrees counter-clockwise from three o'clock: the mouth turns to it while reading, the tendril runs at it while writing. From a Hoop, use `azimuthOf`. */
  azimuth?: number;
  /** 0 to 1: how hard it is driven. It stirs the surface, feeds the filament and widens the glow, in every form. Default 0. */
  drive?: number;
}
export declare function Core(props: CoreProps): React.ReactElement;

export interface SignalLoopProps {
  /** `thinking`: dashes that turn (a turn is being worked on); `working`: the whole loop breathing (tools running, output arriving); `idle`: a still ring. */
  state: 'thinking' | 'working' | 'idle';
  /** `accent` for the agent the view is about; `secondary` (ice) for the helpers it started. */
  signal?: 'accent' | 'secondary';
  /** One agent's own mark: the colour its material's body reads as, kept at rest. For telling whose something is. */
  material?: 'mercury' | 'tube' | 'wire' | 'plasma';
  /** Its name for assistive tech and its tooltip. Give one whenever `material` carries meaning. */
  label?: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}
export declare function SignalLoop(props: SignalLoopProps): React.ReactElement;

export interface SpinnerProps { size?: number; label?: React.ReactNode; className?: string; style?: React.CSSProperties }
export declare function Spinner(props: SpinnerProps): React.ReactElement;

export interface BadgeProps { tone?: 'neutral' | 'info' | 'positive' | 'warn' | 'danger'; glyph?: boolean; children?: React.ReactNode; className?: string; style?: React.CSSProperties }
export declare function Badge(props: BadgeProps): React.ReactElement;

/* ---------- quiet until it's true ---------- */

/** The four places, and the core: where an arrival lands, and so the side it comes in from. */
/** Where an arrival comes from: the thing it belongs to, the foot, the companion, or the center. */
export type Place = 'center' | 'object' | 'dock' | 'core';

export interface ArrivalProps {
  /** True while the thing is true. It arrives when this turns true and settles when it turns false. */
  when: boolean;
  /** The place that caused it; it comes in from there. Default `center`. */
  from?: Place;
  /** `lock` (default) for anything arriving at a place; `lobe` only for what the companion draws out of itself. */
  spring?: 'lock' | 'lobe';
  /** Milliseconds it stays still after `when` turns false, before it settles. `duration-linger` (2400) for something that resolved on its own. Default 0. */
  linger?: number;
  /** Called once it has settled and gone. Keep rendering the Arrival (with `when={false}`) until then. */
  onGone?: () => void;
  /** The element it renders as. Default `div`. */
  as?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Arrival(props: ArrivalProps): React.ReactElement | null;

export interface SceneProps {
  /** The instrument: a Hoop round a Core. Always present. With no `work` it has the center; with work it docks at the foot. */
  instrument: React.ReactNode;
  /** What is being worked on: a chat, a document. Leave it out for the home screen. */
  work?: React.ReactNode;
  /** What the companion says or holds for your word, above the controls: a Stream, a Prepared action. */
  held?: React.ReactNode;
  /** Controls for what is present right now, at the foot: a Composer, Stop while it speaks. */
  controls?: React.ReactNode;
  /** The one Opening. While it is open the docked instrument stays leaned in. */
  opening?: React.ReactNode;
  /** Drive the lean yourself: true holds the docked instrument at `size-instrument-near`. Left out, it follows the pointer, focus and touch. */
  near?: boolean;
  onNear?: (near: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}
/** Home (`size-instrument-home`), docked (`size-instrument-rest`) and leaned in (`size-instrument-near`): one instrument at three sizes, moving on the lock spring. */
export declare function Scene(props: SceneProps): React.ReactElement;

export interface HoopItem {
  id: string | number;
  /** Its name. Read out under the hoop while it faces you, or while you point at it. */
  label: string;
  /** How it stands, in a few words or a number, read out under its name: "14 / 26", "Waiting for your start". */
  detail?: string;
  /** 0 to 1: how much of its slot's top edge is lit. How far it has got. */
  progress?: number;
  /** Its square: `idle` lit and still (the default); `asleep` the frame alone; `working` a ring of accent dashes turning in it; `waiting` the accent, breathing; `done` green; `failed` red; `more` three dots, for a run's further things. */
  state?: 'idle' | 'asleep' | 'working' | 'waiting' | 'done' | 'failed' | 'more';
  /** Helpers at work on it: a bead each along its foot, up to three. */
  agents?: number;
  /** 0 to 1: how much it matters. A heavier thing stands taller. Absent, it stands the band's full height. */
  weight?: number;
}
export interface HoopRun {
  id: string;
  /** What the run holds: "Chats", "Runs". Written along the ground beside it, and read out before a thing's name. */
  label: string;
  /** Its things, side by side round the hoop. */
  items: HoopItem[];
}
export interface HoopGauge {
  /** 0 to 1. */
  value: number;
  /** What it measures: "Context", "Fixed". */
  label?: string;
  /** The reading in words, for its plate: "124k of 200k". */
  detail?: string;
  /** From this value up it turns `warn-dot`. Default 0.8. */
  warn?: number;
  /** From this value up it turns `danger-dot`. Default 1: only when full. */
  danger?: number;
}
export interface HoopProps {
  /** The runs, in their order round the hoop. A run with nothing in it is left out. */
  runs: HoopRun[];
  /** The id of the thing that faces you. Change it and the hoop is brought to it. */
  value?: string | number;
  defaultValue?: string | number;
  /** Another thing has come to the front. */
  onChange?: (item: HoopItem, run: HoopRun) => void;
  /** The thing at the front was pressed, or Enter: open it. `point` is its slot in client coordinates. */
  onOpen?: (item: HoopItem, run: HoopRun, point: { x: number; y: number } | null) => void;
  /** While an Opening hangs from it: a press on another thing turns it round and opens it at once. */
  hold?: boolean;
  /** One quantity that fills, worn as a flat ring round the core, or two: the first is worn closest. Grey until it passes `warn`. */
  gauge?: HoopGauge | HoopGauge[];
  /** A press on a measure: where it was pressed, and which, 0 the inner and 1 the outer. */
  onGauge?: (point: { x: number; y: number } | null, index: number) => void;
  /** A press on the core. */
  onCore?: () => void;
  /** Name of the core's button for assistive tools. Default "The core". */
  coreLabel?: string;
  /** The core's square in px, its forms room to reach. Default 28% of the hoop's width; its body is about half of it. */
  coreSize?: number;
  /** What the core is dealing with: a line runs from its edge to that thing's slot and a bead travels it, in (read) or out (written). */
  link?: { id: string | number; way: 'in' | 'out' } | null;
  /** How far it leans toward you: its depth over its width. Default 0.52; a hoop round a larger core leans less. */
  lean?: number;
  /** Default true: each run's name is written along the ground. A hoop standing small writes none. */
  names?: boolean;
  /** Default true: the thing that faces you is read out in two lines under the hoop. */
  reading?: boolean;
  /** Accessible name of the whole hoop. */
  label?: string;
  /** A Core, drawn in the middle. */
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
export interface HoopHandle {
  /** Where a thing's slot is on screen now, in client coordinates (the middle of its top edge): what an Opening hangs from. */
  pointOf(itemId: string | number): { x: number; y: number } | null;
  /** The direction of a thing's slot from the core, in degrees counter-clockwise from three o'clock: pass it to the Core as `azimuth`. */
  azimuthOf(itemId: string | number): number | null;
}
/** It fills its container and stands as wide as the room allows. Pass a ref to get `pointOf` and `azimuthOf`. */
export declare const Hoop: React.ForwardRefExoticComponent<HoopProps & React.RefAttributes<HoopHandle>>;

export interface TrackStep {
  id: string | number;
  label: string;
  /** Default `next`. */
  state?: 'done' | 'live' | 'next' | 'failed' | 'waiting';
}
export interface TrackProps {
  /** In order. Lit up to the first step that is not done. */
  steps: TrackStep[];
  /** What this is the course of: "restorly-scheduling". */
  label?: string;
  /** Keep one step named. */
  value?: string | number;
  /** A step was clicked: open it. `point` is its place on the line in client coordinates. */
  onOpen?: (step: TrackStep, point: { x: number; y: number }) => void;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Track(props: TrackProps): React.ReactElement;

export interface OpeningProps {
  open: boolean;
  /** The mark it hangs from, in client coordinates, or a function that returns it each frame, such as `() => hoop.current.pointOf(item.id)`. */
  anchor: { x: number; y: number } | null | (() => { x: number; y: number } | null);
  /** Escape, the Esc key cap, or a press anywhere else. */
  onClose?: () => void;
  /** Where it came from, as a label: "Runs", "Chat · PM flow". */
  source?: React.ReactNode;
  title?: React.ReactNode;
  /** A state in words, drawn as a Badge in `tone` beside the title. */
  status?: React.ReactNode;
  tone?: BadgeProps['tone'];
  /** Prefer a side. Default: whichever has room. */
  side?: 'left' | 'right' | 'above' | 'below';
  /** Default `size-opening`. */
  width?: number | string;
  /** Words, lists and the controls that act on the thing. */
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
/** Render it inside a positioned container (a Scene's `opening`). With less than 560px of room it is a sheet at the foot. */
export declare function Opening(props: OpeningProps): React.ReactElement | null;

export interface ReticleProps {
  /** The companion is attending to what this wraps. The corners sweep in and close. */
  active: boolean;
  /** Closes the corners tight: the companion has committed (an action locked, a question taken). */
  locked?: boolean;
  /** What it is doing there, on a plate above: "Reading · Bugfixes". */
  label?: React.ReactNode;
  /** `accent` for the companion; `secondary` (ice) for a helper it started. */
  tone?: 'accent' | 'secondary';
  /** False closes the corners in without the turn: for anything as wide as the page. */
  sweep?: boolean;
  as?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Reticle(props: ReticleProps): React.ReactElement;

export interface FootprintProps {
  /** The companion's name, read to assistive tech ("Answered by Kaylee"). Default "the companion". */
  by?: string;
  /** What it did, one word: Answered, Sent, Prepared, Kept. Omit for the bare mark. */
  children?: React.ReactNode;
  /** Mark size in px. Default 14. */
  size?: number;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Footprint(props: FootprintProps): React.ReactElement;

export interface YourWordsProps {
  /** Your line, exactly as you said or typed it. Never a paraphrase. */
  children: React.ReactNode;
  via?: 'spoken' | 'typed';
  /** When: "09:31". */
  at?: string;
  /** Default "You". */
  who?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function YourWords(props: YourWordsProps): React.ReactElement;

export interface PreparedProps {
  /** The verb it will do, which is also its button: Queue, Send, Merge. */
  action: string;
  /** What it acts on: "Roadmap · Arrival physics". */
  target?: React.ReactNode;
  /** Makes the target a button: go to the thing this will act on. */
  onTarget?: () => void;
  /** How long it holds for your word, in milliseconds or as a CSS time. Default `duration-hold`. The line under it runs down over this. `false`: it waits with no clock, the line stands whole, and `onExpire` never fires. */
  hold?: number | string | false;
  /** The hold ran out with no word: let it dissolve. */
  onExpire?: () => void;
  /** One line: what will happen. */
  children: React.ReactNode;
  /** `holding` (default) until your word; `locked` once it moved on it. */
  state?: 'holding' | 'locked';
  /** Your line that locked it, shown as YourWords. */
  words?: React.ReactNode;
  via?: 'spoken' | 'typed';
  at?: string;
  /** The companion's name for its Footprint. */
  by?: string;
  onLock?: () => void;
  onDismiss?: () => void;
  /** Accessible name of the Esc key cap that dismisses it. Default "Dismiss". */
  dismissLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Prepared(props: PreparedProps): React.ReactElement;

/* ---------- one call away ---------- */

export interface KeyProps { children: React.ReactNode; pressed?: boolean; title?: string; className?: string; style?: React.CSSProperties }
/** A keycap for the key that reaches something: ⌘, ↵, Esc, a digit. Pair it with the word for what it does. */
export declare function Key(props: KeyProps): React.ReactElement;

export interface SummonItem { id?: string | number; source: React.ReactNode; label: React.ReactNode; hint?: React.ReactNode }
export interface SummonProps {
  open: boolean;
  onClose?: () => void;
  query?: string;
  onQuery?: (query: string) => void;
  /** What matches the query, most likely first. */
  items?: SummonItem[];
  onPick?: (item: SummonItem) => void;
  /** The companion's name for the mark beside the line. */
  by?: string;
  /** While you speak: a live trace of your voice in the line, driven by `signal`. */
  listening?: boolean;
  signal?: SignalSource;
  /** Default "Say it or type it". */
  placeholder?: string;
  /** Accessible name. Default "Call up anything". */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}
/** Arrives from the core on the lobe and focuses its line. ↑↓ move, ↵ opens, Esc closes. */
export declare function Summon(props: SummonProps): React.ReactElement | null;

export interface SheetProps {
  open: boolean;
  onClose?: () => void;
  title: React.ReactNode;
  /** `dock` (default) rises from the foot; `end` comes in from the far edge, full height. */
  from?: 'dock' | 'end';
  width?: number | string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}
/** Covers its positioned container (the Scene). Escape, the scrim and the Esc key close it; focus returns. */
export declare function Sheet(props: SheetProps): React.ReactElement | null;

export interface TraceEvent {
  id?: string | number;
  /** "09:41". */
  at?: string;
  source: React.ReactNode;
  text?: React.ReactNode;
  status?: React.ReactNode;
  tone?: BadgeProps['tone'];
  /** The companion did it: a Footprint with `did` ("Answered"). */
  by?: string;
  did?: string;
  /** It moved on your word: YourWords. */
  words?: React.ReactNode;
  via?: 'spoken' | 'typed';
}
export interface TraceProps { events: TraceEvent[]; max?: number; label?: string; className?: string; style?: React.CSSProperties }
/** Newest first; renders nothing when there is nothing. */
export declare function Trace(props: TraceProps): React.ReactElement | null;

/* ---------- the companion ---------- */

export interface OrbitProps { count: number; max?: number; size?: number; label?: string; title?: string; className?: string; style?: React.CSSProperties }
/** What is waiting, as beads on the core's orbit; "+N" past `max` (8). */
export declare function Orbit(props: OrbitProps): React.ReactElement;

export interface StreamProps {
  /** The text so far. */
  text: string;
  /** More is coming: new words arrive and a working loop rides at the end. */
  live?: boolean;
  /** `body` (field-text, default) or `large` (transcript, for what is also spoken). */
  size?: 'body' | 'large';
  /** Default 'off'. */
  ariaLive?: 'off' | 'polite';
  className?: string;
  style?: React.CSSProperties;
}
export declare function Stream(props: StreamProps): React.ReactElement;

export interface ExchangeProps {
  /** Your line, exactly. */
  said?: React.ReactNode;
  via?: 'spoken' | 'typed';
  at?: string;
  who?: string;
  /** The companion's answer so far. */
  reply?: string | null;
  live?: boolean;
  by?: string;
  size?: 'body' | 'large';
  ariaLive?: 'off' | 'polite';
  className?: string;
  style?: React.CSSProperties;
}
export declare function Exchange(props: ExchangeProps): React.ReactElement;

export type ChoiceOption = string | { value: string; label: React.ReactNode; detail?: React.ReactNode };
export interface ChoiceProps {
  question: React.ReactNode;
  options: ChoiceOption[];
  /** The option chosen (the rest step back), or with `multiple` the options chosen so far. */
  value?: string | string[] | null;
  /** One answer: the value picked, or null when Other takes its place. With `multiple`: every value now chosen. */
  onPick?: (value: any) => void;
  /** Several answers can be chosen. Nothing locks until `locked`. */
  multiple?: boolean;
  /** Add the last row, Other, on 0: your own answer in your own words. */
  other?: boolean;
  /** What is typed under Other; null while Other is off. */
  otherValue?: string | null;
  /** Other was turned on (''), typed in, or turned off (null). */
  onOther?: (text: string | null) => void;
  otherLabel?: string;
  otherPlaceholder?: string;
  /** Hold the answer still. Default: true once a single answer is picked and there is no Other; otherwise false until you say. */
  locked?: boolean;
  /** The option the companion expects: it wears the reticle until you choose. */
  likely?: string | null;
  /** The companion's name, read to assistive tech with the likely pick. */
  by?: string;
  /** Where the question came from: "Chat · Bugfixes". */
  source?: React.ReactNode;
  /** Your line, when you chose by saying it. */
  words?: React.ReactNode;
  via?: 'spoken' | 'typed';
  at?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Choice(props: ChoiceProps): React.ReactElement;

export interface Question { question: string; options: ChoiceOption[]; multiple?: boolean; likely?: string | null; /** A word or two for its step: "Target". */ header?: string }
export interface QuestionAnswer { values: string[]; other: string | null }
export interface QuestionsProps {
  /** Asked together, answered one at a time. */
  questions: Question[];
  /** One entry per question, in order. Nothing is sent before Submit. */
  onSubmit?: (answers: QuestionAnswer[]) => void;
  /** Skip, or Skip all: answer none of them. */
  onSkip?: () => void;
  /** Once answered: pass the answers and it is the record of what you said. */
  answers?: (QuestionAnswer | null)[];
  by?: string;
  source?: React.ReactNode;
  at?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Questions(props: QuestionsProps): React.ReactElement | null;

export interface FormField { id: string; label: string; type?: 'text' | 'number' | 'select' | 'boolean'; options?: Option[]; required?: boolean; value?: string | number | boolean }
export interface FormProps {
  /** Who asks: "the deploy tool". Shown as "… asks for your input". */
  from?: string;
  message?: React.ReactNode;
  fields: FormField[];
  onSubmit?: (values: Record<string, string | number | boolean>) => void;
  onDecline?: () => void;
  /** Once settled: the record. With `submitted`, pass `values`. */
  result?: 'submitted' | 'declined';
  values?: Record<string, string | number | boolean>;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Form(props: FormProps): React.ReactElement;

/** How a tool call came out. Said at the end of its row only when it is not ordinary: Working, Failed, Denied, Needs you, Allowed by you. `finished` says nothing. */
export type ToolState = 'running' | 'finished' | 'error' | 'denied' | 'waiting' | 'allowed';
export interface ToolRowProps {
  /** The tool's name: Bash, Read, Edit, Thinking. */
  label: React.ReactNode;
  /** Its mark. `tool` when it has none. */
  icon?: IconName;
  /** What it acted on, in the session's own words when it gave any; else the command or the file's name. */
  title?: React.ReactNode;
  /** Set a title that is a command or a path in the instrument's figures. */
  mono?: boolean;
  /** Makes the title a link (a file that opens); the rest of the line still folds. */
  onTitle?: (event: React.MouseEvent) => void;
  state?: ToolState;
  /** Lines added and removed, beside the name of an edit. */
  diff?: { added?: number; removed?: number };
  /** A run of the same tool: the count, with the rows themselves as children. */
  count?: number;
  /** A short fact at the end of the line, before the state: "14 matches". */
  note?: React.ReactNode;
  /** What a run opens to: the command, after a `$`. */
  command?: string;
  /** What came back. Its count of lines shows while the row is folded. */
  output?: string;
  /** Overrides the count of lines. */
  lines?: number;
  /** Text for the copy button: on the line on hover, and inside what the row opens to under a finger. */
  copy?: string | (() => string);
  copyLabel?: string;
  /** Whatever else it opens to: an Excerpt of the change, a thought as Prose. */
  children?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  className?: string;
  style?: React.CSSProperties;
}
/** One thing a session did, folded to a line. The whole line opens it; with nothing to open it is not a button. */
export declare function ToolRow(props: ToolRowProps): React.ReactElement;

export interface ProseProps {
  /** The markdown. */
  text?: string;
  children?: string;
  /** Still arriving: what is before the last blank line has settled and takes its forms; the block being written stays plain. */
  streaming?: boolean;
  /** Keep single line breaks, for words a person typed. */
  breaks?: boolean;
  /** Set back, for a thought. */
  quiet?: boolean;
  /** Makes a path in a code span (`src/rules.ts:43`) a link. */
  onFile?: (file: { path: string; line: number | null }, event: React.MouseEvent) => void;
  /** Adds a copy button under the text that copies it as markdown. */
  copy?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
/** What a session wrote, read as markdown and set to be read. The same rules dress markup under `ast-prose reading`. */
export declare function Prose(props: ProseProps): React.ReactElement;

export interface MeterProps {
  /** 0 to 1, or null for no reading: then it draws its track alone and an em-dash. */
  value: number | null;
  /** What is measured: its name for assistive tech. */
  label: string;
  /** The reading in words for assistive tech, when a bare percent is not enough: "63% used". */
  valueText?: string;
  /** From here it is warn, and from here danger, judged on the rounded figure. Below both it is quiet. */
  warn?: number;
  danger?: number;
  /** Under the ring: "wk · 3d". */
  caption?: React.ReactNode;
  /** The ring's diameter (32). */
  size?: number;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}
/** One measure, small: a ring with its figure inside, for a column of them. Quiet until it is high. The large one is ArcGauge. */
export declare function Meter(props: MeterProps): React.ReactElement;

export interface RailItem { id: string | number; kind: 'you' | 'reply' | 'break'; label?: string; tone?: 'accent' | 'info' }
export interface RailProps {
  /** One for each turn, oldest first. A `break` is a gap in the spine. */
  items: RailItem[];
  /** The turn in view: its mark is lit. */
  at?: string | number | null;
  /** A press on a mark. */
  onGo?: (id: string | number) => void;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}
/** A long run as a spine of marks, one for each turn. It grows from its foot. */
export declare function Rail(props: RailProps): React.ReactElement;

export interface FileItem { id?: string | number; name: string; size?: number; /** A picture's address: it is shown as a thumbnail. */ url?: string | null }
export interface FilesProps { files: FileItem[]; onRemove?: (file: FileItem) => void; onOpen?: (file: FileItem) => void; label?: string; className?: string; style?: React.CSSProperties }
/** Renders nothing when there are none. */
export declare function Files(props: FilesProps): React.ReactElement | null;

export interface RosterAgent { id?: string; name: React.ReactNode; state: 'thinking' | 'working' | 'idle'; activity?: React.ReactNode; since?: number; helper?: boolean }
export interface RosterProps { agents: RosterAgent[]; label?: string; className?: string; style?: React.CSSProperties }
/** Idle agents are left out; with nobody working it renders nothing. */
export declare function Roster(props: RosterProps): React.ReactElement | null;

export interface Step { id?: string | number; label: React.ReactNode; state: 'done' | 'live' | 'next' | 'failed'; detail?: React.ReactNode; thinking?: boolean }
export interface StepsProps { steps: Step[]; label?: string; className?: string; style?: React.CSSProperties }
export declare function Steps(props: StepsProps): React.ReactElement;

export interface ExcerptLine { n: number; text: string; kind?: 'add' | 'del' }
export interface ExcerptProps {
  path: React.ReactNode;
  lines?: ExcerptLine[];
  /** Or plain text, numbered from `start`. */
  text?: string;
  start?: number;
  /** The line being read: the read head sits on it. */
  at?: number;
  /** The companion's name for its Footprint; `false` to leave the Footprint off. */
  by?: string | false;
  /** Default "Reading". */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Excerpt(props: ExcerptProps): React.ReactElement;

/* ---------- a measure, and labels ---------- */

export interface ArcGaugeProps {
  /** 0–1. */
  value: number;
  label?: string;
  unit?: string;
  decimals?: number;
  format?: (value: number) => string;
  /** From this value up the ring is warn-dot and the label carries ▲. */
  warnAt?: number;
  /** Its diameter in px (132). The figure scales with it, so three fit where two did. */
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}
export declare function ArcGauge(props: ArcGaugeProps): React.ReactElement;

export interface PlateProps { children: React.ReactNode; tone?: 'accent' | 'quiet'; leader?: 'start' | 'end'; className?: string; style?: React.CSSProperties }
export declare function Plate(props: PlateProps): React.ReactElement;

export interface RuleProps { children: React.ReactNode; align?: 'start' | 'end'; level?: number; className?: string; style?: React.CSSProperties }
/** A heading with its hairline, drawn in when it arrives. */
export declare function Rule(props: RuleProps): React.ReactElement;

/* ---------- more controls ---------- */

export interface SwitchProps { checked: boolean; onChange?: (next: boolean) => void; label: string; showLabel?: boolean; disabled?: boolean; className?: string; style?: React.CSSProperties }
export declare function Switch(props: SwitchProps): React.ReactElement;

export interface FaderProps {
  value: number;
  onChange?: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  decimals?: number;
  format?: (value: number) => string;
  /** Values the pointer catches on. When given, they replace the tenth ticks: the marks are the scale and the presets at once. */
  detents?: number[];
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}
export declare function Fader(props: FaderProps): React.ReactElement;

export interface ComposerProps {
  value: string;
  onChange?: (value: string) => void;
  onSend?: (value: string) => void;
  /**
   * The talk press, the mic before Send: one press opens the mic, the next stops it and sends what was heard.
   * `state` is `idle`, `listening` (lit, your voice traced in the line) or `transcribing` (dashes turn round the mic; a press records again).
   * `name` is who hears you ("Talk to Kaylee"), `binding` the key or button bound to the same press ("F8"), `error` what failed with the last press, said above the line.
   */
  talk?: { state: 'idle' | 'listening' | 'transcribing'; onToggle: () => void; name?: string; binding?: string | null; error?: string | null };
  /** Dictation: the mic toggle, and a live trace of your voice in the line while listening. */
  onListen?: (next: boolean) => void;
  listening?: boolean;
  signal?: SignalSource;
  /** What you sent is on its way: the lower edge crawls. A string names it for assistive tools ("Sending"). */
  busy?: boolean | string;
  /** 0 to 1: the lower edge fills as the work your message started gets done. */
  progress?: number;
  placeholder?: string;
  /** The word on its one button while there is something to send. Default "Send"; "Queue" while a turn runs. */
  sendLabel?: string;
  sendTitle?: string;
  /** Files riding in the line, as chips. */
  files?: FileItem[];
  /** Files were picked, pasted or dropped on the line. Passing it adds the plus. */
  onFiles?: (files: File[]) => void;
  onRemoveFile?: (file: FileItem) => void;
  /** A file is being dragged over your work: the line takes the accent edge. */
  dropping?: boolean;
  /** Pass it while a turn runs: with nothing to send, the one button is Stop. */
  onStop?: () => void;
  /** Send was held for half a second. The press that follows sends nothing. */
  onHold?: () => void;
  /** How many lines it grows to before it scrolls. Default 7. */
  maxRows?: number;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}
/** Send arrives only once there is something to send. ↵ sends. Its lower edge is the status of your last message. */
export declare function Composer(props: ComposerProps): React.ReactElement;

/** Wrap any source as a per-frame reader (cached within a frame). An AnalyserNode is reconfigured: fftSize 2048, no smoothing. */
export declare function createSignal(source: SignalSource): SignalReader;
/** A synthetic, voice-shaped signal that speaks the instrument's line on a loop. For previews and empty states only. */
export declare const demoSignal: SignalReader & { words: string[]; text: string; state: () => VoiceState };
/** "D3 +12¢" for 148.25 Hz. */
export declare function noteName(hz: number): string;

declare global {
  interface Window {
    Astrolabe: {
      Button: typeof Button; ToggleButton: typeof ToggleButton; FileButton: typeof FileButton; SegmentedControl: typeof SegmentedControl;
      TextField: typeof TextField; Select: typeof Select; Dock: typeof Dock; Icon: typeof Icon;
      KeyValueList: typeof KeyValueList; Status: typeof Status; Readout: typeof Readout;
      BufferGauge: typeof BufferGauge; ReadoutRow: typeof ReadoutRow;
      Transcript: typeof Transcript; Notice: typeof Notice; Core: typeof Core;
      SignalLoop: typeof SignalLoop; Spinner: typeof Spinner; Badge: typeof Badge;
      Scene: typeof Scene; Arrival: typeof Arrival; Reticle: typeof Reticle; Footprint: typeof Footprint; YourWords: typeof YourWords; Prepared: typeof Prepared;
      Sheet: typeof Sheet; Summon: typeof Summon; Trace: typeof Trace; Key: typeof Key; Orbit: typeof Orbit; Stream: typeof Stream; Exchange: typeof Exchange;
      Choice: typeof Choice; Roster: typeof Roster; Steps: typeof Steps; Excerpt: typeof Excerpt;
      ArcGauge: typeof ArcGauge; Plate: typeof Plate; Rule: typeof Rule; Switch: typeof Switch; Fader: typeof Fader; Composer: typeof Composer; Files: typeof Files; Questions: typeof Questions; Form: typeof Form; ToolRow: typeof ToolRow; Prose: typeof Prose; Rail: typeof Rail; Meter: typeof Meter;
      createSignal: typeof createSignal; demoSignal: typeof demoSignal; noteName: typeof noteName;
    };
  }
}
