import { parse, transform } from "@markdoc/markdoc";
import type { Config } from "@markdoc/markdoc";

export function parseMarkdownToReact(markdown: string, options: Config = {}) {
  return transform(parse(markdown), options);
}
