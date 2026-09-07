import { Switch } from '@/shared/ui';

type SettingsToggleProps = {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
};

/**
 * Used by the settings module's appearance, browser-use, tasks and voice tabs to render a
 * boolean setting switch.
 *
 * It is the library `Switch` under a settings-shaped prop name (`ariaLabel`, which four tabs
 * already pass) — kept rather than replaced at every call site so the settings tabs keep one
 * spelling, and so the paint stays the library's rather than a second track-and-knob here.
 */
export default function SettingsToggle({ checked, onChange, ariaLabel, disabled }: SettingsToggleProps) {
  return <Switch checked={checked} onChange={onChange} label={ariaLabel} disabled={disabled} />;
}
