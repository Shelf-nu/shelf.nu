/**
 * Mobile Dropdown Styles
 *
 * Workaround for Radix popover/dropdown positioning on mobile viewports.
 * Injects a scoped `@media` rule that disables the popper's transform
 * (which Radix uses for positioning) so the dropdown renders where
 * expected on small screens.
 *
 * Replaces ~20 duplicated `<style>` blocks across action-dropdown
 * components (see PR https://github.com/Shelf-nu/shelf.nu/pull/304 for
 * history). Only renders when `open` is true, matching the prior
 * call-site pattern.
 *
 * Uses the React-native `<style>{css}</style>` form (safe text child),
 * not an injected-HTML approach, so there is no XSS concern and no need
 * for suppression comments.
 */

type MobileDropdownStylesProps = {
  /** Whether the dropdown is open — matches existing call-site gating. */
  open: boolean;
};

export function MobileDropdownStyles({ open }: MobileDropdownStylesProps) {
  if (!open) return null;
  return <style>{MOBILE_DROPDOWN_CSS}</style>;
}

const MOBILE_DROPDOWN_CSS = `@media (max-width: 640px) {
  [data-radix-popper-content-wrapper] {
    transform: none !important;
    will-change: auto !important;
  }
}`;
