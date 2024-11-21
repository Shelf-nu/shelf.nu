import React from "react";
import IconHug from "./iconHug";
import type { IconType } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

export interface IconProps {
  icon: IconType;
  disableWrap?: true;
  size?: React.ComponentProps<typeof IconHug>["size"];
}
const Icon = React.forwardRef<HTMLElement, IconProps>(function Icon(
  { icon, disableWrap, size = "sm" }: IconProps,
  _ref
) {
  return (
    icon &&
    (disableWrap ? (
      <div>{iconsMap[icon]}</div>
    ) : (
      <IconHug size={size}>{iconsMap[icon]}</IconHug>
    ))
  );
});

export default Icon;
