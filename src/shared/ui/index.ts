/**
 * The shared UI primitives.
 *
 * The rule is that a component earns a place here once a second feature module
 * renders it. Card has two now (chat and memory-intake). Collapsible and Shimmer
 * still have consumers in the chat module only, and they stay anyway: 16 files
 * across six modules hand-roll their
 * own expand/collapse state today, and moving Collapsible into chat/ would put
 * it behind a module boundary that makes it unreachable to the five modules with
 * the clearest use for it. The two-module rule is a bar for admission, not a
 * trigger for eviction.
 *
 * PromptInput is a kit and not a primitive: the composer form, its header, body,
 * textarea, footer, tools, button and submit, with no chat vocabulary in any of
 * their props, and nothing of its own to import but cn, Button and Tooltip. Queue
 * stays out, on the other test: it is a chat-domain composition — the tool todo
 * list — with chat vocabulary in its prop names and one consumer, the chat's own
 * TodoList.
 *
 * DockableFab and SplitPane came in with one consumer, the application switcher, on
 * the doctrine's other test: they are mechanism — pointer capture, a viewport clamp,
 * a dock hit-test, a clamped divider — which no arrangement of the parts here can
 * produce, so every screen that wants either composes it rather than rebuilding it.
 *
 * ResizeGrip has one consumer, chat-host's floating panel, and came in on the same test: a resize is a
 * pointer drag that must survive a cross-origin frame under it, which is `usePointerDrag`'s body class
 * and its `'resize'` kind. A grip a panel wrote for itself would be a drag that dies over the
 * application it is standing on.
 *
 * ClaudeCodeMark came in with one consumer, the composer's DeepSeek chip, by the operator's ruling
 * that a mark is a kit glyph and never an inline one-off: a brand mark drawn inside one module is
 * the copy the next module to need it re-draws slightly differently. The chat module's transcript
 * and subagent rows now draw it too, for Claude, through `LLMProviderLogo`'s `claudeMark="mascot"`
 * — the same door and the same one glyph, not a copy of it with its own grid.
 *
 * RegionImage came in with one consumer, the affected-areas module, on the mechanism test: an SVG layer that
 * shares an image's coordinate space, a polygon hit-test and a badge clamped inside the image are what no
 * arrangement of the parts here produces, and the photo-match viewer is its next consumer. Gallery came in
 * because Verve draws it (§10 Media) — "If Verve draws it, it is in the library", with or without a second
 * module. Both paint in verve/media.css; both put a photo in a box through PhotoFill, which is not exported
 * from here: the broken-image tile is one drawing for the two, and nothing outside this folder asks for it.
 *
 * SphereView came in with one consumer, the affected-areas module's pano screen, on the same mechanism test: a WebGL sphere
 * with a frame loop, its drag and zoom, and outlines laid on it by yaw and pitch are what no arrangement of the parts here
 * produces. Its next is the roadmap's photo work, where in a tour's pano a CompanyCam photo was taken. It knows a cube, its
 * outlines and their tones; the engine's faces, areas and looks stay in the module. three.js and the viewer load in a chunk
 * of their own the first time a sphere is drawn, so this barrel names the piece and never its canvas (`sphere/`).
 *
 * SegmentedControl and DataTable came in because Verve draws them (§11 Plumbing and §5), with or without a second
 * module ("If Verve draws it, it is in the library. Full stop."), for the affected-areas module's marking screens: the
 * three switches and the proving tables. They paint in verve/data.css. The chat transcript's own `DataTable`
 * (modules/chat/transcript/shapes) is a different job — react-markdown children with a CSV copy — and stays there.
 */

// The library's paint, imported once for its side effect so that every consumer of this
// barrel gets it — and only here, because `verve/` holds stylesheets and no module of its
// own. tokens.css (the colours these rules read) is imported by src/main.tsx, but AFTER App, so it
// lands LATER in the cascade than every file below and wins any equal-specificity tie with them.
import '@/shared/ui/verve/controls.css';
import '@/shared/ui/verve/feedback.css';
// The FAB and split-pane paint shares no selector with the files either side of it, so its only
// constraint is that board.css stays last, below.
import '@/shared/ui/verve/surfaces.css';
// panels.css holds the paint of TextArea, Sheet, Timeline, Steps, Checkbox and DialogFrame. `.vv-textarea` composes
// `.vv-input` (controls.css) and wins each tie it has — against `.vv-input`'s colours, against
// src/index.css's pins on every `textarea` and against `text-sm`'s line height — by specificity, never by
// order. The Sheet, Timeline, Steps, Checkbox and DialogFrame rules share no selector with any sibling. So nothing
// here depends on its place against controls.css, feedback.css or surfaces.css, and the one constraint
// is that board.css stays last, below.
import '@/shared/ui/verve/panels.css';
// media.css holds the paint of RegionImage, SphereView and Gallery. Its place is free: no selector in it is shared with
// any sibling sheet (`.vv-region*`, `.vv-sphere*` and `.vv-gallery*` are its own), and every rule reads only tokens, so
// nothing depends on its landing before or after controls.css, feedback.css, surfaces.css or panels.css.
// The one constraint is still that board.css stays last, below.
import '@/shared/ui/verve/media.css';
// data.css holds the paint of SegmentedControl and DataTable. Like media.css, its place is free: `.vv-segmented*` and
// `.vv-datatable*` are its own and every rule reads only tokens. The one constraint is still that board.css stays last, below.
import '@/shared/ui/verve/data.css';
// The board layer goes LAST on purpose, and the order is load-bearing: a lane card composes
// `.vv-card`'s ground and then overrides its background, shadow and transition. Imported first,
// `.vv-card` won every one of those at equal specificity and a selected card lost its wash.
import '@/shared/ui/verve/board.css';

export { ActionMenu } from '@/shared/ui/ActionMenu';
export type { ActionMenuItem } from '@/shared/ui/ActionMenu';
export { Avatar } from '@/shared/ui/Avatar';
export { Badge } from '@/shared/ui/Badge';
export { badgeVariants } from '@/shared/ui/badgeVariants';
export { Banner } from '@/shared/ui/Banner';
export { Button } from '@/shared/ui/Button';
export { buttonVariants } from '@/shared/ui/buttonVariants';
export { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/shared/ui/Card';
// The one fold a card's header can wear: the chevron glyph every foldable surface draws, the button
// the four lane cards press, and the body slot that puts `inert` + `aria-hidden` on a folded card's
// hidden content. The glyph is shared with the chat's shape cards on purpose — `ShapeFrame` draws it
// too, so there is one sign and not two look-alikes.
export { CardFoldBody, CardFoldToggle, FoldChevron } from '@/shared/ui/CardFold';
// Verve's forms/Checkbox: a real checkbox input with its box and tick painted, the words beside it taking
// the press too. The cerberus tab's Update wardens dialog is the first: one row a node whose warden is
// behind, ticked to choose which to update.
export { Checkbox } from '@/shared/ui/Checkbox';
export { Chip } from '@/shared/ui/Chip';
export { ClaudeCodeMark } from '@/shared/ui/ClaudeCodeMark';
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui/Collapsible';
export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/shared/ui/Command';
export { DarkModeToggle } from '@/shared/ui/DarkModeToggle';
// Verve's §5 sortable data table: sort arrows on the heads, `aria-sort` on the sorted one, a row that opens under
// itself. The affected-areas module's proving tables are drawn with it.
export { DataTable } from '@/shared/ui/DataTable';
export { AppLogo } from '@/shared/ui/AppLogo';
export { default as DeepSeekLogo } from '@/shared/ui/DeepSeekLogo';
export { Dialog, DialogTrigger, DialogContent, DialogTitle } from '@/shared/ui/Dialog';
// Verve's overlays/Modal on the Dialog above: a 520 or 600 wide panel with the serif title and its accent word and the
// round ✕, closing from Escape, the backdrop and the ✕, whose paint is `.vv-dialogframe*`. The cerberus tab's Mute, Enroll,
// Promote and Update wardens dialogs are framed by it: a kit piece rather than the module's own because Verve draws it, so
// the next module with a form to raise composes the frame instead of building another.
export { DialogFrame } from '@/shared/ui/DialogFrame';
export { DockableFab } from '@/shared/ui/DockableFab';
export type { DockableFabPosition } from '@/shared/ui/DockableFab';
export { ResizeGrip } from '@/shared/ui/ResizeGrip';
export { EmptyState } from '@/shared/ui/EmptyState';
export { Field } from '@/shared/ui/Field';
// Verve's §10 Media gallery: square photo tiles, each with its tag, the final tile collapsing the overflow into
// "+N", the grey tile where a photo is missing. The affected-areas module draws a tour's panos with it.
export { Gallery } from '@/shared/ui/Gallery';
export { Input } from '@/shared/ui/Input';
export { KanbanCard } from '@/shared/ui/KanbanCard';
export type { CardPriority, KanbanCardModel, KanbanCardSignals } from '@/shared/ui/KanbanCard';
export { KanbanLane } from '@/shared/ui/KanbanLane';
export { Lightbox } from '@/shared/ui/Lightbox';
export { LLMProviderLogo } from '@/shared/ui/LLMProviderLogo';
export { Menu } from '@/shared/ui/Menu';
export { Meter } from '@/shared/ui/Meter';
export { PillBar, Pill } from '@/shared/ui/PillBar';
export {
  PromptInput,
  PromptInputHeader,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputButton,
  PromptInputSubmit,
} from '@/shared/ui/PromptInput';
export type {
  PromptInputProps,
  PromptInputButtonTooltip,
  PromptInputButtonProps,
  PromptInputSubmitProps,
} from '@/shared/ui/PromptInput';
export { QuestionOptionRow } from '@/shared/ui/QuestionOptionRow';
// A photo with its regions drawn over it: one SVG in the image's own 0..1 space (outline weight constant at any size
// and zoom), a numbered badge at each region's corner, a press on either selecting it. The affected-areas module draws
// a view's regions with it; the photo-match viewer is next. It also takes a box dragged on the photo (`drawing`) and
// dims every region but the focused one (`focusId`).
export { RegionImage } from '@/shared/ui/RegionImage';
export { ScrollArea } from '@/shared/ui/ScrollArea';
// Verve's §11 SegmentedControl: a radio group drawn as one tray, the chosen option lifted, an optional count on each.
// The affected-areas module's Tours · Mark · Tables switch, the pano's layer switch and the Mark screen's queue mode.
export { SegmentedControl } from '@/shared/ui/SegmentedControl';
export { Select } from '@/shared/ui/Select';
export { SettingRow } from '@/shared/ui/SettingRow';
// The panel pinned to the right edge over a scrim, on Dialog's host-window portal and Escape rule. The
// cerberus tab's CheckSheet is the first; it is a kit piece rather than a module's own because a
// detail that sits beside a screen is every screen's, and the Escape order it keeps with a dialog or
// a menu in front is the kit's to hold.
export { Sheet } from '@/shared/ui/Sheet';
export { Shimmer } from '@/shared/ui/Shimmer';
export { Spinner } from '@/shared/ui/Spinner';
// Six photos of a cube stitched into one sphere you drag and zoom, with RegionImage's outlines and numbered badges laid on
// it by yaw and pitch. The affected-areas module's pano screen draws a pano's six views with it; the viewer loads on first use.
export { SphereView } from '@/shared/ui/SphereView';
export { SplitPane, SPLIT_MIN_RATIO, SPLIT_MAX_RATIO } from '@/shared/ui/SplitPane';
export { Stepper } from '@/shared/ui/Stepper';
// Verve's navigation stepper: numbered rounds, a ✓ once done, an accent rail between. `Steps` and not
// `Stepper`, which is the numeric minus/plus control above. The cerberus tab's Enroll dialog draws
// Name it · Install · Say hello with it.
export { Steps } from '@/shared/ui/Steps';
export { Switch } from '@/shared/ui/Switch';
export { Tabs } from '@/shared/ui/Tabs';
// A status sentence with each hyphenated word (a model id, a version) held whole: the Custom compaction
// row and the Dactyls field in Edit Agent Chains draw their Waiting line's reason through it.
export { WholeWords } from '@/shared/ui/WholeWords';
// The multi-line field `Input` has no sibling for: Verve's own TextArea on Input's field paint.
// The roadmap's dialogs take it for a goal: ItemDialog adds and edits every kind of item with one. The
// cerberus tab's Mute dialog takes it for the reason a mute is raised.
export { TextArea } from '@/shared/ui/TextArea';
// Verve's chronological feed: a tone dot, the source pill, a title, a summary when full, the time, and a
// row that opens to its meta. The cerberus tab draws it twice — dense in Fleet's "What happened" card,
// full in History's "Everything since" — and the transcript's `shapes/Timeline` stays its own rail.
export { Timeline } from '@/shared/ui/Timeline';
export { Toast } from '@/shared/ui/Toast';
export { ToastStack } from '@/shared/ui/ToastStack';
export { Tooltip } from '@/shared/ui/Tooltip';
// The waiting ring and the failure banner around a lazy view: the Cerberus tab's `KeptView` surrounds the Tours view and
// the Bulletins view with it, so a chunk that cannot load stays that view's message, never the whole tab's.
export { ViewBoundary } from '@/shared/ui/ViewBoundary';
export { ConfirmDialog } from '@/shared/ui/ConfirmDialog';
