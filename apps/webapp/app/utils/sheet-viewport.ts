/**
 * Sheet Viewport
 *
 * The one breakpoint at which action menus switch between a bottom sheet and a
 * regular dropdown. The CSS that positions the sheet, the triggers, the
 * QR-scan auto-open and the close handling all read it from here, so they
 * switch at exactly the same width.
 *
 * @see {@link file://./../components/shared/mobile-dropdown-styles.tsx}
 * @see {@link file://./../hooks/use-controlled-dropdown-menu.ts}
 */

/**
 * Every viewport at which the menus render as a bottom sheet: all widths below
 * Tailwind's `md` breakpoint (768px), where they switch to a regular dropdown.
 *
 * Written as the exact complement of `md`, the form Tailwind's own `max-md:`
 * variant uses. A zoomed or non-integer-scaled display can report a fractional
 * width such as 767.3px, which `(max-width: 767px)` misses while `md` has not
 * started yet, leaving the sheet anchored to its trigger.
 */
export const SHEET_MEDIA_QUERY = "not all and (min-width: 768px)";

/**
 * Whether the viewport is one where the menus render as a bottom sheet.
 *
 * The JS side of {@link SHEET_MEDIA_QUERY}: read it from the same query so the
 * sheet's behaviour switches at exactly the width its styling does. `false`
 * during server rendering.
 *
 * @returns `true` below `md`, including fractional widths such as 767.3px
 */
export function isSheetViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(SHEET_MEDIA_QUERY).matches
  );
}
