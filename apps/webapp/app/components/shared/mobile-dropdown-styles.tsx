/**
 * Mobile Dropdown Styles
 *
 * Shared `@media` rule for the action menus that turn into a bottom sheet on
 * small screens. Each of those menus styles its content as a fixed sheet
 * (`fixed bottom-0 ... w-screen`) below Tailwind's `md` breakpoint and as a
 * regular dropdown from `md` up. Radix positions the menu with a `transform`
 * on its popper wrapper, relative to the trigger; a fixed sheet inside that
 * transformed wrapper is anchored to the trigger instead of the viewport and
 * opens off the top of the screen. This rule removes the transform so the
 * sheet sits at the bottom of the viewport.
 *
 * Each sheet's content element carries `data-mobile-sheet`, and the rule only
 * touches the popper wrapper holding that element, so a tooltip or select
 * shown while the sheet is open keeps its own positioning. Browsers without
 * `:has()` fall back to clearing every wrapper's transform.
 *
 * Every width below `md` (`SHEET_MEDIA_QUERY`) gets the phone behaviour as a
 * whole: the sheet, the open-only trigger (`md:hidden`, the toggle trigger is
 * `hidden md:flex`), the QR-scan auto-open and, after it, the Escape and
 * item-select close (`isSheetViewport`). Every menu that renders a sheet must
 * render this component; `mobile-dropdown-styles.test.tsx` pins the query and
 * that list.
 *
 * With the transform gone the sheet is detached from its trigger, so the
 * trigger-relative available-height cap on `DropdownMenuContent` no longer
 * describes the space it has. This rule caps a `DropdownMenuContent` sheet
 * against the viewport instead, and it scrolls past that. A `PopoverContent`
 * sheet carries no menu attribute for the rule to target, so it caps itself
 * with `max-h-[85dvh] overflow-y-auto` below `md`.
 *
 * Sheets fade in rather than slide; that rule is in `styles/global.css`, not
 * here, because it has to outlive the menu's open state.
 *
 * Renders only while the menu is open. Uses the React-native
 * `<style>{css}</style>` form (safe text child), not an injected-HTML
 * approach, so there is no XSS concern and no need for suppression comments.
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

type MobileDropdownStylesProps = {
  /** Whether the menu is open. The rule is only injected while it is. */
  open: boolean;
};

/**
 * Injects the bottom-sheet positioning rule while a menu is open.
 *
 * @param props - {@link MobileDropdownStylesProps}
 */
export function MobileDropdownStyles({ open }: MobileDropdownStylesProps) {
  if (!open) return null;
  return <style>{MOBILE_DROPDOWN_CSS}</style>;
}

const MOBILE_DROPDOWN_CSS = `@media ${SHEET_MEDIA_QUERY} {
  [data-radix-popper-content-wrapper]:has([data-mobile-sheet]) {
    transform: none !important;
    will-change: auto !important;
  }
  [data-mobile-sheet][data-radix-menu-content] {
    max-height: 85dvh !important;
  }
}
@supports not selector(:has(*)) {
  @media ${SHEET_MEDIA_QUERY} {
    [data-radix-popper-content-wrapper] {
      transform: none !important;
      will-change: auto !important;
    }
  }
}`;
