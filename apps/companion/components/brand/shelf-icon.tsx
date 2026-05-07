/**
 * Shelf brand icon — orange rounded-rect with white shelf lines.
 *
 * SVG paths extracted from the webapp's full logo component
 * (`apps/webapp/app/components/brand/logo.tsx`, icon portion).
 * Original viewBox: 79.771 x 79.771.
 */

import Svg, { Path, Rect, type SvgProps } from "react-native-svg";

type ShelfIconProps = Omit<SvgProps, "viewBox"> & {
  /** Icon size (width = height). Default 80. */
  size?: number;
  /** Background color of the icon square. Default Shelf orange. */
  iconBgColor?: string;
  /** Color of the shelf line shapes. Default white. */
  iconShelfsColor?: string;
};

const VIEWBOX = "0 0 79.771 79.771";

export default function ShelfIcon({
  size = 80,
  iconBgColor = "#FF7809",
  iconShelfsColor = "#FFFFFF",
  ...rest
}: ShelfIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox={VIEWBOX}
      accessibilityLabel="Shelf icon"
      {...rest}
    >
      {/* Orange background */}
      <Rect width={79.771} height={79.771} rx={12} fill={iconBgColor} />

      {/* Shelf line shapes */}
      <Path d="M19.044 26.569h16.031v6.413H19.044z" fill={iconShelfsColor} />
      <Path
        d="M27.06 23.362v-6.413l25.65-2.432v8.845Z"
        fill={iconShelfsColor}
      />
      <Path d="M27.06 36.188h25.65v6.413H27.06z" fill={iconShelfsColor} />
      <Path d="M44.694 45.807h16.031v6.413H44.694z" fill={iconShelfsColor} />
      <Path d="M27.06 64.527v-9.1h25.65v6.412Z" fill={iconShelfsColor} />
    </Svg>
  );
}
