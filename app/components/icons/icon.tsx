import React from "react";
import IconHug from "./iconHug";
import type { IconType } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

export interface IconProps {
  icon: IconType;
  disableWrap?: true;
}
const Icon = React.forwardRef<HTMLElement, IconProps>(function Icon(
  { icon, disableWrap }: IconProps,
  _ref
) {
  return (
    icon &&
    (disableWrap ? (
      <div>{iconsMap[icon]}</div>
    ) : (
      <IconHug size="sm">{iconsMap[icon]}</IconHug>
    ))
  );
});

export default Icon;
