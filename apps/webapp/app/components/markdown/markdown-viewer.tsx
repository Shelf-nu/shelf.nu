import React from "react";
import type { ComponentProps, ComponentType } from "react";
import type { RenderableTreeNodes } from "@markdoc/markdoc";
import { renderers } from "@markdoc/markdoc";
import { markdocConfig } from "~/utils/markdoc.config";
import { parseMarkdownToReact } from "~/utils/md";
import { sanitizeMarkdocTree } from "~/utils/sanitize-markdoc-tree";
import { tw } from "~/utils/tw";
import { AssetsListComponent } from "./assets-list-component";
import { AuditImagesComponent } from "./audit-images-component";
import { BookingStatusComponent } from "./booking-status-component";
import { CategoryBadgeComponent } from "./category-badge-component";
import { DateComponent } from "./date-component";
import { DescriptionComponent } from "./description-component";
import { KitsListComponent } from "./kits-list-component";
import { LinkComponent } from "./link-component";
import { TagComponent } from "./tag-component";

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
  components?: Record<string, ComponentType>;
  className?: string;
  pre?: string;
  disablePortal?: boolean;
  /**
   * Allow off-origin links in this content.
   *
   * Defaults to `false` — safe for system-generated notes, whose text we
   * assemble from entity names, so any external link in one was injected.
   * Pass `true` only for genuinely author-written content (user comments,
   * admin announcements), where linking out is a deliberate feature.
   * Dangerous schemes and off-origin images are blocked regardless.
   */
  allowExternalLinks?: boolean;
}

// Default components map including our custom components
const defaultComponents = {
  DateComponent,
  AssetsListComponent,
  AuditImagesComponent,
  KitsListComponent,
  LinkComponent,
  BookingStatusComponent,
  DescriptionComponent,
  CategoryBadgeComponent,
  RawBlock: RawBlockComponent,
  TagComponent,
};

/**
 * Stable, module-scope default for the `components` prop.
 * Declared outside the component so memoised derivations don't invalidate
 * on every render (`rerender-memo-with-default-value`).
 */
const EMPTY_COMPONENTS: Record<string, ComponentType> = {};

/**
 * Module-scope wrapper that injects `disablePortal` into AuditImagesComponent.
 * Hoisted out of MarkdownViewer to avoid `no-nested-component-definition`.
 */
const AuditImagesComponentNoPortal = (
  props: ComponentProps<typeof AuditImagesComponent>
) => <AuditImagesComponent {...props} disablePortal={true} />;
AuditImagesComponentNoPortal.displayName = "AuditImagesComponentNoPortal";

export const MarkdownViewer = ({
  content,
  components = EMPTY_COMPONENTS,
  pre,
  className,
  disablePortal,
  allowExternalLinks = false,
}: Props) => {
  const styles = tw("pm-doc", className);

  // Select which AuditImagesComponent variant to render based on disablePortal.
  const WrappedAuditImages = disablePortal
    ? AuditImagesComponentNoPortal
    : AuditImagesComponent;

  // Merge custom components with defaults
  const allComponents = React.useMemo(
    () => ({
      ...defaultComponents,
      ...components,
      AuditImagesComponent: WrappedAuditImages,
    }),
    [components, WrappedAuditImages]
  );

  // Parse content if it's a string, otherwise use as-is.
  //
  // SECURITY: sanitize the resulting tree before rendering. Markdoc turns
  // ordinary Markdown link/image syntax into NATIVE `a`/`img` nodes that never
  // reach our custom tag components, so `[x](https://evil.example)` inside a
  // stored note would otherwise render as a working anchor and an image would
  // fire an off-origin request on load. Sanitizing here — rather than during
  // parsing — also covers pre-parsed `RenderableTreeNodes` passed straight in,
  // and protects notes already stored in the database.
  const parsedContent = React.useMemo(() => {
    const tree =
      typeof content === "string"
        ? parseMarkdownToReact(content, markdocConfig)
        : content;

    return sanitizeMarkdocTree(tree, { allowExternalLinks });
  }, [content, allowExternalLinks]);

  return (
    <div className={styles}>
      {pre && pre}
      {renderers.react(parsedContent, React, { components: allComponents })}
    </div>
  );
};
