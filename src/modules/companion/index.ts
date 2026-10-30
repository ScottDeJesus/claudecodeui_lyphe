// Kaylee's public surface, for the project-workspace module (its shell holds the provider, its frame draws the panel and her
// button, its rail her dock, its command palette opens her) and the settings module (its voice tab draws her section).
// Everything else in this module is private.
export { CompanionProvider, useCompanion } from '@/modules/companion/context/CompanionContext';
export { CompanionPanel } from '@/modules/companion/CompanionPanel';
export { CompanionFab } from '@/modules/companion/CompanionFab';
export { CompanionDock } from '@/modules/companion/CompanionDock';
export { CompanionSettingsSection } from '@/modules/companion/CompanionSettingsSection';
