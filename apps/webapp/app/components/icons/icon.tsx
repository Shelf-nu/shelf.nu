import React from "react";
import type { ComponentProps } from "react";
import IconHug from "./iconHug";
import type { IconType } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

export interface IconProps {
  className?: string;
  icon: IconType;
  disableWrap?: true;
  size?: ComponentProps<typeof IconHug>["size"];
}
const Icon = React.forwardRef<HTMLElement, IconProps>(function Icon(
  { className, icon, disableWrap, size = "sm" }: IconProps,
  _ref
) {
  return (
    icon &&
    (disableWrap ? (
      <div>{iconsMap[icon]}</div>
    ) : (
      <IconHug className={className} size={size}>
        {iconsMap[icon]}
      </IconHug>
    ))
  );
});

export default Icon;
