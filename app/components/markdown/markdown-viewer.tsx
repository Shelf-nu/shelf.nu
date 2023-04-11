import React from "react";
import type { RenderableTreeNodes } from "@markdoc/markdoc";
import { renderers } from "@markdoc/markdoc";
import { tw } from "~/utils";

interface Props {
  content: RenderableTreeNodes;
  components?: Record<string, React.ComponentType>;
  className?: string;
}

export const MarkdownViewer = ({
  content,
  components = {},
  className,
}: Props) => {
  const styles = tw("markdown-viewer", className);
  return (
    <div className={styles}>
      {renderers.react(content, React, { components })}
    </div>
  );
};
