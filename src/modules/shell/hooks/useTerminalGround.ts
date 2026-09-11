import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { ITheme, Terminal } from '@xterm/xterm';

import { useTheme } from '@/shared/context/ThemeContext';
import { readTerminalGround } from '@/modules/shell/utils/terminalTheme';

type UseTerminalGroundOptions = {
  terminalRef: MutableRefObject<Terminal | null>;
  /** True once the terminal exists, so the first read happens on a terminal there is. */
  isInitialized: boolean;
  /** The ANSI sixteen the ground is laid under. */
  baseTheme: ITheme | undefined;
};

/**
 * Keeps a live terminal's ground on the current theme.
 *
 * xterm.js holds a COPY of the colours it was built with, so a terminal left alone here keeps
 * its light background through a switch to dark. This re-reads the tokens on every flip.
 *
 * The tokens are current by the time this effect runs: ThemeProvider puts `dark` on `<html>` in
 * a layout effect, ahead of every ordinary effect of the same update. The write is still
 * deferred one frame, for xterm's sake rather than the theme's: on the render that marks the
 * terminal initialized its renderer has not measured itself yet, and assigning a theme then
 * throws inside xterm ("Cannot read properties of undefined (reading 'dimensions')" — measured
 * 2026-09-10 by phase 16 with the write made synchronous).
 */
export function useTerminalGround({ terminalRef, isInitialized, baseTheme }: UseTerminalGroundOptions): void {
  const { isDarkMode } = useTheme();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      if (terminal) {
        terminal.options.theme = { ...baseTheme, ...readTerminalGround() };
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [baseTheme, isDarkMode, isInitialized, terminalRef]);
}
