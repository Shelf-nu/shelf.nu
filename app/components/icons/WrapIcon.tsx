import React from "react";
import IconHug from "./IconHug";
import iconsMap from "../shared/icons-map";
import { Icon } from "../shared/icons-map";

export interface WrapIconProps {
    icon?: Icon;
    enableWrap?: boolean;
}
const WrapIcon = React.forwardRef<HTMLElement, WrapIconProps>(
    function WrapIcon(
        {
            icon,
            enableWrap
        }: WrapIconProps
    ){
        return icon && enableWrap && <IconHug size="sm">{iconsMap[icon]}</IconHug>
    }
)
// const WrapIcon = (icon:Icon, defaultSize = "sm", enableWrap = true) => {
// //   const WrappedIcon = ({
// //     size = defaultSize,
// //     wrapped = enableWrap,
// //     width = "22",
// //     height = "22",
// //     ...props
// //   }) =>
// //     // If wrapping is enabled, wrap with IconHug; otherwise, return the original component
// //     wrapped ? (
// //       <IconHug size="sm">
// //         <Component width="22" height="22" {...props} />
// //       </IconHug>
// //     ) : (
// //       <Component {...props} />
// //     );
// //   return WrappedIcon;
//     {console.log(iconsMap[icon])}
//     return <></>

// };

export default WrapIcon;
