import { parse, transform } from "@markdoc/markdoc";
import type { Config } from "@markdoc/markdoc";

export function parseMarkdownToReact(markdown: string, options: Config = {}) {
  const config = {
    ...options,
    nodes: {
      ...options.nodes,
      /**
       * Markdown renders link a native <a> tags by default, which causes a full page reload.
       * To prevent this, we replace it with Remix's <Link> component for internal links.
       * External links will still use <a> and open in new tab.
       */
      link: {
        render: "Link",
        attributes: {
          href: { type: String, required: true },
        },
      },
    },
  } satisfies Config;

  return transform(parse(markdown), config);
}
