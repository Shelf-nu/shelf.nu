import type { HTMLAttributes } from "react";
import { createElement, useMemo } from "react";
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
  charactersPerLine = 30,
  text,
}: LineBreakTextProps) {
  const lines = useMemo(() => {
    const lines = [];
    let startIndex = 0;

    for (let i = 0; i < numberOfLines; i++) {
      const endIndex = startIndex + charactersPerLine;

      if (startIndex >= text.length) break;

      const textToPush = text.slice(startIndex, endIndex);
      lines.push(i === numberOfLines - 1 ? `${textToPush}...` : textToPush);

      startIndex = endIndex;
    }

    return lines;
  }, [charactersPerLine, numberOfLines, text]);

  return createElement(as, {
    className: tw("w-full whitespace-pre-wrap md:w-60", className),
    style,
    children: lines.map((line, i) => <span key={i}>{line}</span>),
  });
}
