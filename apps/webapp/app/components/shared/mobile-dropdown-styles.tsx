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
 * The rule therefore has to cover every width the sheet styling covers: up to
 * one pixel below `md` (`SHEET_MAX_WIDTH`). Pinned against the Tailwind config
 * by `mobile-dropdown-styles.test.tsx`.
 *
 * With the transform gone the sheet is detached from its trigger, so the
 * trigger-relative available-height cap on `DropdownMenuContent` no longer
 * describes the space it has. The sheet is capped against the viewport instead
 * and scrolls past that.
 *
 * Renders only while the menu is open. Uses the React-native
 * `<style>{css}</style>` form (safe text child), not an injected-HTML
 * approach, so there is no XSS concern and no need for suppression comments.
 */

/**
 * Widest viewport, in px, at which the menus render as a bottom sheet: one
 * pixel below Tailwind's `md` breakpoint (768px), where they switch to a
 * regular dropdown.
 */
export const SHEET_MAX_WIDTH = 767;

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

const MOBILE_DROPDOWN_CSS = `@media (max-width: ${SHEET_MAX_WIDTH}px) {
  [data-radix-popper-content-wrapper] {
    transform: none !important;
    will-change: auto !important;
  }
  [data-radix-popper-content-wrapper] [data-radix-menu-content] {
    max-height: 85dvh !important;
  }
}`;
