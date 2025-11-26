import type { KeyboardEvent } from "react";

/**
 * Keyboard key constants for accessibility
 */
export const KEYS = {
  ENTER: "Enter",
  SPACE: "Space",
  ESCAPE: "Escape",
  TAB: "Tab",
  ARROW_UP: "ArrowUp",
  ARROW_DOWN: "ArrowDown",
  ARROW_LEFT: "ArrowLeft",
  ARROW_RIGHT: "ArrowRight",
} as const;

/**
 * Checks if the keyboard event is an activation key (Enter or Space)
 * These are the standard keys that should trigger button/interactive element actions
 * @param event - Keyboard event
 * @returns true if Enter or Space was pressed
 */
export function isActivationKey(event: KeyboardEvent): boolean {
  return event.code === KEYS.ENTER || event.code === KEYS.SPACE;
}

/**
 * Helper to handle activation key presses (Enter/Space) for interactive elements
 * Automatically prevents default behavior and calls the callback
 * @param callback - Function to call when activation key is pressed
 * @returns Keyboard event handler
 */
export function handleActivationKeyPress(
  callback: () => void
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (isActivationKey(event)) {
      event.preventDefault();
      callback();
    }
  };
}
