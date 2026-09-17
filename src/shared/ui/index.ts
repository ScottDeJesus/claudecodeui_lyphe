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
 * PromptInput, Queue and Confirmation did move out, on a different
 * test: they are not primitives at all but chat-domain compositions — the
 * composer form, the tool todo list and the
 * inline tool-permission request — with chat vocabulary in their prop names and
 * no plausible second consumer. Alert went with Confirmation, which was its only
 * importer and the reason it existed.
 *
 * DockableFab and SplitPane came in with one consumer, the application switcher, on
 * the doctrine's other test: they are mechanism — pointer capture, a viewport clamp,
 * a dock hit-test, a clamped divider — which no arrangement of the parts here can
 * produce, so every screen that wants either composes it rather than rebuilding it.
 */

// The library's paint, imported once for its side effect so that every consumer of this
// barrel gets it — and only here, because `verve/` holds stylesheets and no module of its
// own. tokens.css (the colours these rules read) is imported by src/main.tsx, but AFTER App, so it
// lands LATER in the cascade than every file below and wins any equal-specificity tie with them.
import '@/shared/ui/verve/controls.css';
import '@/shared/ui/verve/feedback.css';
// The FAB and split-pane paint shares no selector with the files either side of it, so its only
// constraint is the next line's: board.css stays last.
import '@/shared/ui/verve/surfaces.css';
// The board layer goes LAST on purpose, and the order is load-bearing: a lane card composes
// `.vv-card`'s ground and then overrides its background, shadow and transition. Imported first,
// `.vv-card` won every one of those at equal specificity and a selected card lost its wash.
import '@/shared/ui/verve/board.css';

export { ActionMenu } from '@/shared/ui/ActionMenu';
export type { ActionMenuItem } from '@/shared/ui/ActionMenu';
export { Avatar } from '@/shared/ui/Avatar';
export { Badge } from '@/shared/ui/Badge';
export { Banner } from '@/shared/ui/Banner';
export { Button, buttonVariants } from '@/shared/ui/Button';
export { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/shared/ui/Card';
export { Chip } from '@/shared/ui/Chip';
export { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui/Collapsible';
export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/shared/ui/Command';
export { DarkModeToggle } from '@/shared/ui/DarkModeToggle';
export { default as DeepSeekLogo } from '@/shared/ui/DeepSeekLogo';
export { Dialog, DialogTrigger, DialogContent, DialogTitle } from '@/shared/ui/Dialog';
export { DockableFab } from '@/shared/ui/DockableFab';
export type { DockableFabPosition } from '@/shared/ui/DockableFab';
export { EmptyState } from '@/shared/ui/EmptyState';
export { Field } from '@/shared/ui/Field';
export { Input } from '@/shared/ui/Input';
export { KanbanCard } from '@/shared/ui/KanbanCard';
export type { CardPriority, KanbanCardModel, KanbanCardSignals } from '@/shared/ui/KanbanCard';
export { KanbanLane } from '@/shared/ui/KanbanLane';
export { LLMProviderLogo } from '@/shared/ui/LLMProviderLogo';
export { Menu } from '@/shared/ui/Menu';
export { Meter } from '@/shared/ui/Meter';
export { PillBar, Pill } from '@/shared/ui/PillBar';
export { ScrollArea } from '@/shared/ui/ScrollArea';
export { Select } from '@/shared/ui/Select';
export { Shimmer } from '@/shared/ui/Shimmer';
export { Spinner } from '@/shared/ui/Spinner';
export { SplitPane, SPLIT_MIN_RATIO, SPLIT_MAX_RATIO } from '@/shared/ui/SplitPane';
export { Stepper } from '@/shared/ui/Stepper';
export { Switch } from '@/shared/ui/Switch';
export { Tabs } from '@/shared/ui/Tabs';
export { Toast } from '@/shared/ui/Toast';
export { ToastStack } from '@/shared/ui/ToastStack';
export { Tooltip } from '@/shared/ui/Tooltip';
