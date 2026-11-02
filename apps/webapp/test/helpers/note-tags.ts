/**
 * Assertions for system note content: a value a person typed must reach the
 * note only inside a Markdoc tag attribute, never as bare text, so a value
 * shaped like a URL can never become a link to that URL.
 *
 * The checks run on the Markdoc PARSE, not on the string, so a value that only
 * turns into bare text after concatenation is still caught.
 *
 * @see {@link file://../../app/utils/markdoc-wrappers.ts} `wrapNameForNote`
 */
import Markdoc from "@markdoc/markdoc";
import type { Node } from "@markdoc/markdoc";
import { expect } from "vitest";

/** A user-typed value shaped like a URL, for the "never a link" regressions. */
export const URL_SHAPED_VALUE = "https://evil.example/login";

/**
 * Asserts that `value` appears in the note only as the `text` attribute of a
 * `name` or `link` tag, and in no text node.
 *
 * @param content - The note content as the writer stored it
 * @param value - The user-typed value to look for
 * @param tagNames - The tags allowed to carry it
 */
export function expectValueOnlyInTag(
  content: string,
  value: string = URL_SHAPED_VALUE,
  tagNames: string[] = ["name", "link"]
) {
  const nodes: Node[] = [...Markdoc.parse(content).walk()];

  const bareText = nodes.filter(
    (node) =>
      node.type === "text" &&
      String(node.attributes.content ?? "").includes(value)
  );
  expect(bareText).toEqual([]);

  const carriers = nodes.filter(
    (node) =>
      node.type === "tag" &&
      tagNames.includes(node.tag ?? "") &&
      node.attributes.text === value
  );
  expect(carriers.length).toBeGreaterThan(0);
}
