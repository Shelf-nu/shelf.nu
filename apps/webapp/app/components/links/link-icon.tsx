/**
 * Draws a chip icon from `@shelf/links` as an inline SVG, so the web chip and
 * the companion chip use the same path data.
 *
 * @see {@link file://./link-chip.tsx}
 */
import { LINK_ICONS, type LinkIconId } from "@shelf/links";
import { tw } from "~/utils/tw";

/**
 * A decorative 16px link icon (hidden from assistive tech: the chip's label
 * names the kind in words).
 *
 * @param props.icon - Which icon to draw, usually `ParsedLink.icon`
 * @param props.className - Extra classes, e.g. a text colour for the stroke
 */
export function LinkIcon({
  icon,
  className,
}: {
  icon: LinkIconId;
  className?: string;
}) {
  const { viewBox, paths } = LINK_ICONS[icon];
  return (
    <svg
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={tw("size-4 shrink-0", className)}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
