import React from "react";
import type { RenderableTreeNodes } from "@markdoc/markdoc";
import { renderers } from "@markdoc/markdoc";
import { Link } from "@remix-run/react";
import { tw } from "~/utils/tw";

interface Props {
  content: RenderableTreeNodes;
  components?: Record<string, React.ComponentType>;
  className?: string;
  pre?: string;
}

const DEFAULT_COMPONENTS: Record<
  string,
  (node: { href: string; children: React.ReactNode }) => React.ReactNode
> = {
  /**
   * Markdown renders link a native <a> tags by default, which causes a full page reload.
   * To prevent this, we replace it with Remix's <Link> component for internal links.
   * External links will still use <a> and open in new tab.
   */
  Link: ({ href, children }) => {
    // Check if the link is internal (relative path) or external (absolute URL)
    const isInternal = href && href.startsWith("/");

    if (isInternal) {
      return <Link to={href}>{children}</Link>;
    }

    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
};

export const MarkdownViewer = ({
  content,
  components = {},
  pre,
  className,
}: Props) => {
  const finalComponents = { ...DEFAULT_COMPONENTS, ...components };

  return (
    <div className={tw("markdown-viewer", className)}>
      {pre && pre}
      {renderers.react(content, React, { components: finalComponents })}
    </div>
  );
};
