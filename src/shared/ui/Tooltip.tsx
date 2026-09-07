import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/shared/utils';

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
  const [isVisible, setIsVisible] = useState(false);
  // Store the timer id without forcing re-renders while hovering.
  const timeoutRef = useRef<number | null>(null);
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
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearTooltipTimer();
    timeoutRef.current = window.setTimeout(() => {
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    clearTooltipTimer();
    setIsVisible(false);
  };

  const handleTouchStart = () => {
    clearTooltipTimer();
    longPressTriggeredRef.current = false;
    timeoutRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setIsVisible(true);
    }, delay);
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
    if (!isVisible || typeof document === 'undefined') {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) {
        return;
      }
      setIsVisible(false);
      longPressTriggeredRef.current = false;
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      setTooltipStyle(null);
      return;
    }

    const rafId = window.requestAnimationFrame(updateTooltipPosition);
    const handleViewportChange = () => updateTooltipPosition();

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isVisible, updateTooltipPosition]);

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
      {isVisible && typeof document !== 'undefined' && createPortal(
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
        document.body
      )}
    </div>
  );
}
