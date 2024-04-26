import React from "react";
import IconHug from "./IconHug";
import type { IconType } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

export interface IconProps {
  icon?: IconType;
  enableWrap?: boolean;
}
const Icon = React.forwardRef<HTMLElement, IconProps>(
  function Icon({ icon, enableWrap }: IconProps) {
    return icon && enableWrap && <IconHug size="sm">{iconsMap[icon]}</IconHug>;
  }
);

export default Icon;
