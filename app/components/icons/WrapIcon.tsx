import React from "react";
import IconHug from "./IconHug";
import type { Icon } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

export interface WrapIconProps {
  icon?: Icon;
  enableWrap?: boolean;
}
const WrapIcon = React.forwardRef<HTMLElement, WrapIconProps>(
  function WrapIcon({ icon, enableWrap }: WrapIconProps) {
    return icon && enableWrap && <IconHug size="sm">{iconsMap[icon]}</IconHug>;
  }
);

export default WrapIcon;
