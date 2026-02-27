/**
 * Skip Links Component
 *
 * Provides keyboard navigation shortcuts to bypass repetitive content
 * and jump directly to main content or navigation.
 *
 * Required for WCAG 2.4.1 Bypass Blocks (Level A) compliance.
 *
 * Usage:
 * - Renders at the top of the page layout
 * - Visually hidden until focused via Tab key
 * - First focusable element on the page
 */

export function SkipLinks() {
  return (
    <nav aria-label="Skip links" className="skip-links">
      <a
        href="#main-content"
        className="skip-link absolute left-[-9999px] top-4 z-[9999] rounded-md border-2 border-primary-600 bg-surface px-4 py-3 text-sm font-medium text-color-900 shadow-lg focus:left-4"
      >
        Skip to main content
      </a>
      <a
        href="#navigation"
        className="skip-link absolute left-[-9999px] top-4 z-[9999] rounded-md border-2 border-primary-600 bg-surface px-4 py-3 text-sm font-medium text-color-900 shadow-lg focus:left-20"
      >
        Skip to navigation
      </a>
    </nav>
  );
}
