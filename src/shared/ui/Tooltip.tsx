import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import { cn, isNodeLike } from '@/shared/utils';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

type TooltipProps = {
  children: ReactNode;
  content?: ReactNode;
  position?: TooltipPosition;
  className?: string;
  delay?: number;
};

/**
 * Where the arrow sits, and which of its four borders is inked.
 *
 * The side classes place it; the `vv-tooltip__arrow--*` marker is what colours it, out of the
 * same `--ink` the bubble is filled with — so the arrow can no longer drift to a different
 * dark than the chip it points out of, which is what two independent grey literals allowed.
 */
function getArrowClasses(position: TooltipPosition): string {
  switch (position) {
    case 'bottom':
      return 'bottom-full left-1/2 transform -translate-x-1/2 vv-tooltip__arrow--bottom';
    case 'left':
      return 'left-full top-1/2 transform -translate-y-1/2 vv-tooltip__arrow--left';
    case 'right':
      return 'right-full top-1/2 transform -translate-y-1/2 vv-tooltip__arrow--right';
    case 'top':
    default:
      return 'top-full left-1/2 transform -translate-x-1/2 vv-tooltip__arrow--top';
  }
}

/** Used by the project-workspace, sidebar and task-master modules and by the shared PromptInput primitive. */
export function Tooltip({
  children,
  content,
  position = 'top',
  className = '',
  delay = 350,
}: TooltipProps) {
  const hostWindow = useHostWindow();
  const [isVisible, setIsVisible] = useState(false);
  // Store the pending show-delay timer without forcing re-renders while hovering. It keeps the window
  // that armed it beside its id: timer ids are per window, so clearing one on a window the chat has
  // since moved to would cancel a stranger's timer, or nothing.
  const timeoutRef = useRef<{ id: number; armedOn: Window } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties | null>(null);

  const updateTooltipPosition = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const spacing = 8;
    const style: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
    };

    // Calculate tooltip position based on the specified position prop.
    switch (position) {
      case 'bottom':
        style.left = rect.left + rect.width / 2;
        style.top = rect.bottom + spacing;
        style.transform = 'translateX(-50%)';
        break;
      case 'left':
        style.left = rect.left - spacing;
        style.top = rect.top + rect.height / 2;
        style.transform = 'translate(-100%, -50%)';
        break;
      case 'right':
        style.left = rect.right + spacing;
        style.top = rect.top + rect.height / 2;
        style.transform = 'translateY(-50%)';
        break;
      case 'top':
      default:
        style.left = rect.left + rect.width / 2;
        style.top = rect.top - spacing;
        style.transform = 'translate(-50%, -100%)';
        break;
    }

    setTooltipStyle(style);
  }, [position]);

  const clearTooltipTimer = () => {
    if (timeoutRef.current !== null) {
      timeoutRef.current.armedOn.clearTimeout(timeoutRef.current.id);
      timeoutRef.current = null;
    }
  };

  // The delay paces when the reader sees the tooltip, so it runs on the window the reader is in:
  // a hidden opener throttles its timers to about one a minute.
  const armShowTimer = (onFire: () => void) => {
    timeoutRef.current = { id: hostWindow.setTimeout(onFire, delay), armedOn: hostWindow };
  };

  const handleMouseEnter = () => {
    clearTooltipTimer();
    armShowTimer(() => {
      setIsVisible(true);
    });
  };

  const handleMouseLeave = () => {
    clearTooltipTimer();
    setIsVisible(false);
  };

  const handleTouchStart = () => {
    clearTooltipTimer();
    longPressTriggeredRef.current = false;
    armShowTimer(() => {
      longPressTriggeredRef.current = true;
      setIsVisible(true);
    });
  };

  const handleTouchEnd = () => {
    clearTooltipTimer();
    if (longPressTriggeredRef.current) {
      return;
    }
    setIsVisible(false);
  };

  useEffect(() => {
    // Avoid delayed updates after unmount.
    return () => {
      clearTooltipTimer();
    };
  }, []);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      // `nodeType`, not `instanceof Node`: a target in the floating window is that window's node.
      if (isNodeLike(target) && containerRef.current?.contains(target)) {
        return;
      }
      setIsVisible(false);
      longPressTriggeredRef.current = false;
    };

    const hostDocument = hostWindow.document;
    hostDocument.addEventListener('pointerdown', handlePointerDown, true);
    return () => hostDocument.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isVisible, hostWindow]);

  useEffect(() => {
    if (!isVisible) {
      setTooltipStyle(null);
      return;
    }

    const rafId = hostWindow.requestAnimationFrame(updateTooltipPosition);
    const handleViewportChange = () => updateTooltipPosition();

    hostWindow.addEventListener('resize', handleViewportChange);
    hostWindow.addEventListener('scroll', handleViewportChange, true);

    return () => {
      hostWindow.cancelAnimationFrame(rafId);
      hostWindow.removeEventListener('resize', handleViewportChange);
      hostWindow.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isVisible, updateTooltipPosition, hostWindow]);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {children}
      {isVisible && createPortal(
        // Two elements, because one cannot do both jobs: `tooltipStyle` places the bubble with
        // a `transform`, and `vv-pop` animates `transform` — on a single element the keyframe
        // wins for its quarter second and the tooltip flies in from the viewport's top-left.
        // The outer box positions, the inner box paints and pops (doctrine §4).
        <div
          ref={tooltipRef}
          style={tooltipStyle || { position: 'fixed', top: '-9999px', left: '-9999px', opacity: 0 }}
          className="pointer-events-none"
        >
          <div className={cn('vv-tooltip relative whitespace-nowrap', className)}>
            {content}
            {/* Arrow */}
            <div className={cn('vv-tooltip__arrow absolute h-0 w-0', getArrowClasses(position))} />
          </div>
        </div>,
        hostWindow.document.body
      )}
    </div>
  );
}
