import React from "react";
import type { RenderableTreeNodes } from "@markdoc/markdoc";
import { renderers } from "@markdoc/markdoc";
import { tw } from "~/utils/tw";

interface Props {
  content: RenderableTreeNodes;
  components?: Record<string, React.ComponentType>;
  className?: string;
  pre?: string;
}

export const MarkdownViewer = ({
  content,
  components = {},
  pre,
  className,
}: Props) => {
  const styles = tw("markdown-viewer", className);
  return (
    <div className={styles}>
      {pre && pre}
      {renderers.react(content, React, { components })}
    </div>
  );
};
