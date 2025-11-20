import React from "react";
import type { RenderableTreeNodes } from "@markdoc/markdoc";
import { renderers } from "@markdoc/markdoc";
import { markdocConfig } from "~/utils/markdoc.config";
import { parseMarkdownToReact } from "~/utils/md";
import { tw } from "~/utils/tw";
import { AssetsListComponent } from "./assets-list-component";
import { BookingStatusComponent } from "./booking-status-component";
import { DateComponent } from "./date-component";
import { DescriptionComponent } from "./description-component";
import { KitsListComponent } from "./kits-list-component";
import { LinkComponent } from "./link-component";
import { TagComponent } from "./tag-component";
import { TextDiffComponent } from "./text-diff-component";

const RawBlockComponent = ({ raw }: { raw: string }) => (
  <div className="raw-block rounded border border-dashed border-gray-300 bg-gray-50">
    <pre className="overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs text-gray-700">
      {raw}
    </pre>
  </div>
);

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
  DescriptionComponent,
  TextDiffComponent,
  RawBlock: RawBlockComponent,
  TagComponent,
};

export const MarkdownViewer = ({
  content,
  components = {},
  pre,
  className,
}: Props) => {
  const styles = tw("pm-doc", className);

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
