import React from "react";
import type { RenderableTreeNodes } from "@markdoc/markdoc";
import { renderers } from "@markdoc/markdoc";

interface Props {
  content: RenderableTreeNodes;
  components?: Record<string, React.ComponentType>;
}

export const MarkdownView = ({ content, components = {} }: Props) => (
  <>{renderers.react(content, React, { components })}</>
);
