import type { HTMLAttributes } from "react";
import { createElement } from "react";
import { tw } from "~/utils/tw";

type LineBreakTextProps = HTMLAttributes<HTMLParagraphElement> & {
  className?: string;
  style?: React.CSSProperties;

  /** Element tag which will be rendered */
  as?: "p" | "span" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li";

  /** Number of lines to display */
  numberOfLines?: number;

  /** Number of characters in each line */
  charactersPerLine?: number;

  /** Actual text that will be used to display */
  text: string;
};

export default function LineBreakText({
  className,
  style,
  as = "p",
  numberOfLines = 2,
  charactersPerLine: _charactersPerLine = 30,
  text,
  ...rest
}: LineBreakTextProps) {
  const clampStyles = numberOfLines
    ? ({
        display: "-webkit-box" as const,
        WebkitLineClamp: `${numberOfLines}`,
        WebkitBoxOrient: "vertical" as const,
        overflow: "hidden",
      } satisfies React.CSSProperties)
    : undefined;

  return createElement(as, {
    className: tw("w-full whitespace-pre-wrap md:w-60", className),
    style: clampStyles ? { ...clampStyles, ...style } : style,
    children: text,
    ...(numberOfLines
      ? { "data-line-break-text-lines": String(numberOfLines) }
      : {}),
    ...rest,
  });
}
