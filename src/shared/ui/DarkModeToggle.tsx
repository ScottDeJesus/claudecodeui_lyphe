import { Switch } from '@/shared/ui/Switch';
import { useTheme } from '@/shared/context/ThemeContext';

type DarkModeToggleProps = {
  checked?: boolean;
  onToggle?: (nextValue: boolean) => void;
  ariaLabel?: string;
};

/**
 * Used by the settings and quick-settings-panel modules to switch the shared theme.
 *
 * The track, the knob and its spring are the library `Switch` now; what stays here is the only
 * thing this component ever really owned — deciding whether the state comes from a controlling
 * parent or straight from ThemeContext. The sun/moon glyphs the hand-rolled track carried go
 * with it: both consumers already name the row in words beside the control, so the glyph was
 * decoration, and one switch shape across the app beats two that drift.
 *
 * `ariaLabel` is passed through rather than fixed here. Settings names this control
 * "Dark Mode" and that string is what addresses it, so a hard-coded name would silently rename
 * a control two screens depend on.
 */
export function DarkModeToggle({
  checked,
  onToggle,
  ariaLabel = 'Toggle dark mode',
}: DarkModeToggleProps) {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const isControlled = typeof checked === 'boolean' && typeof onToggle === 'function';
  const isEnabled = isControlled ? checked : isDarkMode;

  const handleToggle = () => {
    if (isControlled && onToggle) {
      onToggle(!isEnabled);
      return;
    }

    toggleDarkMode();
  };

  return <Switch checked={isEnabled} onChange={handleToggle} label={ariaLabel} />;
}
