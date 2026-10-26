/**
 * Spinner
 *
 * The app-wide loading indicator: a diamond of 8 square pixels that light up
 * in turn. The animation lives in `app/styles/global.css` (`.diamond-loader`),
 * so every instance shares one set of keyframes.
 *
 * Colour comes from `currentColor`. The default is brand orange; pass a
 * `text-*` class to override it. Buttons with a filled background (primary,
 * danger, info) turn a nested loader white, see `components/shared/button.tsx`.
 *
 * Size it with `size-*` (default `size-5`).
 *
 * @see {@link https://www.loading-ui.com/docs/components/diamond}
 */
import { tw } from "~/utils/tw";

/** Pixel positions on a 20x20 grid, in the order they light up (clockwise from the top). */
const PIXELS = [
  { x: 8, y: 0 },
  { x: 12, y: 4 },
  { x: 16, y: 8 },
  { x: 12, y: 12 },
  { x: 8, y: 16 },
  { x: 4, y: 12 },
  { x: 0, y: 8 },
  { x: 4, y: 4 },
] as const;

/**
 * Renders the diamond loader.
 *
 * It is decorative (`aria-hidden`): callers pair it with visible or `sr-only`
 * text, or wrap it in a `role="status"` region, which is what screen readers
 * announce.
 *
 * @param props.className - Extra classes, typically `size-*`, `text-*` or spacing
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={tw(
        "diamond-loader block size-5 shrink-0 text-primary-500",
        className
      )}
    >
      {PIXELS.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="4" height="4" />
      ))}
    </svg>
  );
}
