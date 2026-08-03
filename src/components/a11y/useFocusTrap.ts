"use client";

import { useEffect, type RefObject } from "react";

/**
 * Phase 5 — Focus trap for modal dialogs.
 *
 * When `active === true`, Tab/Shift+Tab is contained inside the element
 * referenced by `containerRef`. The first focusable child is moved into
 * focus when the trap activates. Escape propagation is NOT handled here —
 * the consumer wires its own Escape listener.
 *
 * Implementation notes:
 * - The focus trap listens to `focusin` (which fires AFTER focus changes)
 *   and pulls focus back into the container if it lands outside. This is
 *   more reliable than intercepting Tab keydown because jsdom and
 *   headless browsers apply the focus shift before firing the keyboard
 *   event in bubble phase.
 * - The `keydown` capture-phase listener still wraps Tab from the last
 *   focusable back to the first (and Shift+Tab from the first to the
 *   last), so the trap is consistent in both directions.
 * - When `active` flips false, both listeners are detached and the hook is
 *   a no-op.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const focusableElements = (): HTMLElement[] => {
      const nodes = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return Array.from(nodes).filter((el) => !el.hasAttribute("aria-hidden"));
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const items = focusableElements();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (!container.contains(target)) {
        // Focus landed outside the modal — pull it back to the first
        // focusable child.
        const items = focusableElements();
        const destination = items[0] ?? container;
        destination.focus();
      }
    };

    // Move focus into the modal so screen readers announce it and keyboard
    // users land on the first actionable element.
    window.setTimeout(() => {
      const items = focusableElements();
      const target = items[0] ?? container;
      target.focus();
    }, 0);

    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown, { capture: true } as EventListenerOptions);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [active, containerRef]);
}