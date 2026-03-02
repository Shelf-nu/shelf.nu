import type { ComponentType, HTMLAttributes, ReactNode } from "react";

interface Props {
  /** What type of heading element do you want to render?
   * Options are: "h1" | "h2" | "h3" | "h4" | "h5"
   */
  as?: ComponentType<any> | string;

  /** Content to be rendered inside the heading */
  children: ReactNode;

  /** Available options for heading size */
  size?: "h1" | "h2" | "h3" | "h4" | "h5";
}

/** Returns a title/heading with the correct size and styling */
export default function Heading({
  as: Component = "h2",
  children,
  className = "",
  size = "h2",
  ...rest
}: Props & HTMLAttributes<HTMLHeadingElement>) {
  const sizeClass = `text-${size}`;

  const styles = `${sizeClass} ${className}`;
  return (
    <Component {...rest} className={styles}>
      {children}
    </Component>
  );
}
