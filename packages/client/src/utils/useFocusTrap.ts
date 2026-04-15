import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * Traps keyboard focus inside the referenced container while it is mounted.
 * Automatically focuses the first focusable element on mount and restores
 * focus to the previously-focused element on unmount.
 *
 * Usage:
 *   const containerRef = useFocusTrap<HTMLDivElement>();
 *   return <div ref={containerRef}>...</div>;
 */
export function useFocusTrap<T extends HTMLElement>(): React.RefObject<T> {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Remember the element that was focused before this modal opened
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus to the first focusable element inside the container.
    // Non-null assertion is safe: the length check guarantees an element exists.
    // (noUncheckedIndexedAccess requires explicit assertion even after a length guard.)
    const focusableElements = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    if (focusableElements.length > 0) {
      focusableElements[0]!.focus();
    }

    // Capture container in a variable that TypeScript can treat as non-null inside the closure.
    // The closure is only registered while the element is mounted, so `container` is always valid.
    const safeContainer = container;

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Tab') return;

      const elements = Array.from(
        safeContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)
      );
      if (elements.length === 0) return;

      const firstElement = elements[0]!;
      const lastElement = elements[elements.length - 1]!;

      if (event.shiftKey) {
        // Shift+Tab: wrap from first → last
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: wrap from last → first
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus to the element that was active before the modal opened
      previouslyFocused?.focus();
    };
  }, []);

  return containerRef;
}
