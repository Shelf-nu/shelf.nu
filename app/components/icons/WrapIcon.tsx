import React from "react";
import IconHug from "./IconHug";
const WrapIcon = (Component: any, defaultSize = "sm", enableWrap = true) => {
  const WrappedIcon = ({
    size = defaultSize,
    wrapped = enableWrap,
    width = "22",
    height = "22",
    ...props
  }) =>
    // If wrapping is enabled, wrap with IconHug; otherwise, return the original component
    wrapped ? (
        
      <IconHug size="sm">
        <Component width="22" height="22" {...props} />
      </IconHug>
    ) : (
      <Component {...props} />
    );
  return WrappedIcon;
};

export default WrapIcon;
