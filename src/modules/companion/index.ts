// Kaylee's public surface, for the project-workspace module (its shell holds the provider, its frame draws the panel, its
// rail the door, its command palette opens her) and the settings module (its voice tab draws her section). Everything else
// in this module is private.
export { CompanionProvider, useCompanion } from '@/modules/companion/context/CompanionContext';
export { CompanionPanel } from '@/modules/companion/CompanionPanel';
export { CompanionDoorButton } from '@/modules/companion/CompanionDoorButton';
export { CompanionSettingsSection } from '@/modules/companion/CompanionSettingsSection';
