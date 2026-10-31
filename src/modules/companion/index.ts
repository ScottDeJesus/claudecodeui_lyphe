// Kaylee's public surface, for the project-workspace module (its shell holds the provider, its frame draws the panel and her
// button, its rail her dock, its command palette opens her), the settings module (its voice tab draws her section) and the
// station module (its route mounts the page's other `CompanionProvider`, with an `onOpen` that puts what she opens on the
// stage; its fallback and its floor hook read `useCompanion`; its right rail draws her action card; its dock draws her draft
// card; its head, conversation and talk control compose her face, state words, controls, log, talk button and composer rather
// than rebuild them; its phone arrangement draws her round talk button in its bottom bar and her action line over it).
// Everything else in this module is private.
export { CompanionProvider, useCompanion } from '@/modules/companion/context/CompanionContext';
export { CompanionPanel } from '@/modules/companion/CompanionPanel';
export { CompanionFab } from '@/modules/companion/CompanionFab';
export { CompanionDock } from '@/modules/companion/CompanionDock';
export { CompanionSettingsSection } from '@/modules/companion/CompanionSettingsSection';
// The action waiting for his word, as her panel draws it in her dock; its second home is the head of the station's right
// rail, "What needs you" (`WhatNeedsYou`), with every rule of MAN-9186.
export { CompanionActionCard } from '@/modules/companion/CompanionActionCard';
// The same action in one line, the card's words and deadline: the station module's phone arrangement stands it over its bottom
// bar while the action waits, and its press opens the whole card in Needs you (it never carries his lines, MAN-9186).
export { CompanionActionLine } from '@/modules/companion/CompanionActionLine';
// Whether the action waiting for his word has lapsed (its deadline, one timer): the card and the line read it, and the station's
// count of what needs him (through the station's `useLivePending`) so an action whose card is gone is not counted.
export { useActionLapse } from '@/modules/companion/hooks/useActionLapse';
// Her draft, its one editor, as her panel draws it last in her dock; its second home is the station's dock (`StationDock`), at
// the foot of her column over the talk control, which hands it `onTargetPress` so the target's name puts its session on the
// stage, with every rule of MAN-9090.
export { CompanionDraftCard } from '@/modules/companion/CompanionDraftCard';
// The pieces the station composes, each defined with its consumers named:
// the one state of hers (MAN-9089): this module's panel, button and face read it, and the station's head reads it for its status line.
export { useCompanionPresence } from '@/modules/companion/hooks/useCompanionPresence';
// her face bound to the provider: this module's button (CompanionFab, inside the disc), and the station's head.
export { CompanionFace } from '@/modules/companion/CompanionFace';
// her state in words with its dot: this module's panel header (CompanionHeader), and the station's head.
export { CompanionStatus } from '@/modules/companion/CompanionStatus';
// her controls (Stop, model, Live, Clear, this device's voice and ears): this module's panel header (CompanionHeader), and the station's head.
export { CompanionControls } from '@/modules/companion/CompanionControls';
// her exchange with him: this module's panel (CompanionPanel), and the station's conversation.
export { CompanionLog } from '@/modules/companion/CompanionLog';
// the talk press: this module's composer (CompanionComposer), the station's talk control (`size: 'large'`), and the round button
// in the center of the station's phone bar (`size: 'round'`).
export { CompanionTalkButton } from '@/modules/companion/CompanionTalkButton';
// the box to type to her: this module's panel (CompanionPanel), and the station's talk control.
export { CompanionComposer } from '@/modules/companion/CompanionComposer';
// her drawn face on any presence: this module's CompanionFace and Settings' face card, and the station's fixtures, which draw her on fixture presences.
export { CompanionAvatar } from '@/modules/companion/CompanionAvatar';
