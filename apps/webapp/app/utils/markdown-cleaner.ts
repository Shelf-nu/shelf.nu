/**
 * Cleans markdown formatting from a text string.
 * Shared between server and client utilities that need a plain-text representation.
 *
 * @param text - Text containing markdown to clean
 * @param options - Behaviour modifiers
 * @returns Plain text with markdown formatting removed
 */
export type CleanMarkdownFormattingOptions = {
  preserveLineBreaks?: boolean;
};

export const cleanMarkdownFormatting = (
  text: string,
  options: CleanMarkdownFormattingOptions = {}
): string => {
  const { preserveLineBreaks = false } = options;

  if (!text) return "";

  let cleaned = text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "") // Remove image references
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1") // Replace markdown links with their text
    .replace(/`{3}([\s\S]*?)`{3}/g, (_match, codeBlock) => codeBlock) // Remove code fence markers
    .replace(/`([^`]+)`/g, "$1") // Remove inline code markers
    .replace(/[*_~]+/g, "") // Remove emphasis characters
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // Remove heading markers
    .replace(/^\s{0,3}>\s?/gm, "") // Remove blockquote markers
    .replace(/\[[^\]]*\]:\s*\S+/g, "") // Remove reference-style link definitions
    .replace(/\[[^\]]*\]/g, (match) => match.replace(/\[|\]/g, "")); // Remove remaining brackets

  if (preserveLineBreaks) {
    cleaned = cleaned
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim().replace(/[ \t]{2,}/g, " "))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  } else {
    cleaned = cleaned.replace(/\r?\n/g, " ").replace(/\s+/g, " ");
  }

  return cleaned.trim();
};
