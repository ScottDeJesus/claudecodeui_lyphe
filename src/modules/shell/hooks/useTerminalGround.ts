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
 * The read is deferred one frame on purpose. ThemeProvider puts `dark` on `<html>` from its
 * OWN effect, and React runs a child's effects BEFORE its parent's — so reading the tokens
 * synchronously would read the theme being left behind, and the terminal would sit one flip
 * out of step for the rest of the session.
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
