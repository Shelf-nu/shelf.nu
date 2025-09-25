import React from "react";
import type { RenderableTreeNodes } from "@markdoc/markdoc";
import { renderers } from "@markdoc/markdoc";
import { markdocConfig } from "~/utils/markdoc.config";
import { parseMarkdownToReact } from "~/utils/md";
import { tw } from "~/utils/tw";
import { AssetsListComponent } from "./assets-list-component";
import { BookingStatusComponent } from "./booking-status-component";
import { DateComponent } from "./date-component";
import { KitsListComponent } from "./kits-list-component";
import { LinkComponent } from "./link-component";

/**
 * MarkdownViewer that supports both string content and RenderableTreeNodes
 *
 * This component automatically detects the content type and handles parsing accordingly:
 * - String content: Parsed client-side with custom components (like DateComponent)
 * - RenderableTreeNodes: Used directly (for content already parsed server-side)
 */

interface Props {
  content: string | RenderableTreeNodes;
  components?: Record<string, React.ComponentType>;
  className?: string;
  pre?: string;
}

// Default components map including our custom components
const defaultComponents = {
  DateComponent,
  AssetsListComponent,
  KitsListComponent,
  LinkComponent,
  BookingStatusComponent,
};

export const MarkdownViewer = ({
  content,
  components = {},
  pre,
  className,
}: Props) => {
  const styles = tw("markdown-viewer", className);

  // Merge custom components with defaults
  const allComponents = { ...defaultComponents, ...components };

  // Parse content if it's a string, otherwise use as-is
  const parsedContent = React.useMemo(() => {
    if (typeof content === "string") {
      return parseMarkdownToReact(content, markdocConfig);
    }
    return content;
  }, [content]);

  return (
    <div className={styles}>
      {pre && pre}
      {renderers.react(parsedContent, React, { components: allComponents })}
    </div>
  );
};
