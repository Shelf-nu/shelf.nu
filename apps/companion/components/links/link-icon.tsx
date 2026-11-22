/**
 * LinkIcon: the kind icon on a link chip (PDF, folder, spreadsheet, generic
 * link), drawn with react-native-svg from the same path data the web app
 * draws as `<svg>`.
 *
 * @see {@link file://../../../../packages/links/src/icons.ts} `LINK_ICONS`
 * @see {@link file://./link-chip.tsx}
 */
import { memo } from "react";
import Svg, { Path } from "react-native-svg";
import { LINK_ICONS, type LinkIconId } from "@shelf/links";

/**
 * A chip icon. Decorative: the chip's accessible label already names the
 * kind, so screen readers skip it.
 *
 * @param props - Component props.
 * @param props.icon - Which icon to draw.
 * @param props.size - Width and height in points.
 * @param props.color - Stroke color.
 * @returns The icon as an SVG element.
 */
export const LinkIcon = memo(function LinkIcon({
  icon,
  size,
  color,
}: {
  icon: LinkIconId;
  size: number;
  color: string;
}) {
  const { viewBox, paths } = LINK_ICONS[icon];
  return (
    <Svg
      width={size}
      height={size}
      viewBox={viewBox}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {paths.map((d, index) => (
        <Path
          // why: a static list of path strings that never reorders
          key={index}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
});
