import { parse, transform, type Config } from "@markdoc/markdoc";

export function parseMarkdownToReact(markdown: string, options: Config = {}) {
  return transform(parse(markdown), options);
}
