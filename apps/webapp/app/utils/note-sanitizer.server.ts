import { formatDate, type ResolvedFormatPrefs } from "./date-format";
import { cleanMarkdownFormatting } from "./markdown-cleaner";

const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const MARKDOC_TAG_REGEX = /{%\s*(\w+)\s*([^%]*?)\s*\/%}/g;

const parseMarkdocAttributes = (rawAttributes: string) => {
  const attributes: Record<string, string> = {};
  const attributeRegex = /(\w+)=("([^"]*)"|(\S+))/g;

  let match: RegExpExecArray | null;
  while ((match = attributeRegex.exec(rawAttributes))) {
    const [, key, , quotedValue, bareValue] = match;
    attributes[key] = (quotedValue ?? bareValue ?? "").trim();
  }

  return attributes;
};

const sanitizeMarkdocTags = (
  text: string,
  prefs: ResolvedFormatPrefs
): string =>
  text.replace(
    MARKDOC_TAG_REGEX,
    (_fullMatch, tagName: string, rawAttributes: string) => {
      const attrs = parseMarkdocAttributes(rawAttributes);
      switch (tagName) {
        case "link": {
          const textAttr = attrs.text ?? attrs.to ?? "";
          return decodeHtmlEntities(textAttr);
        }
        case "date": {
          const value = attrs.value;
          if (!value) return "";

          const includeTime = attrs.includeTime
            ? attrs.includeTime !== "false"
            : true;

          const parsedDate = new Date(value);
          if (Number.isNaN(parsedDate.getTime())) {
            return value;
          }

          try {
            return includeTime
              ? formatDate(parsedDate, prefs, { includeTime: true })
              : formatDate(parsedDate, prefs);
          } catch {
            return value;
          }
        }
        case "assets_list": {
          const count = Number.parseInt(attrs.count ?? "0", 10);
          if (!Number.isFinite(count) || count <= 0) {
            return "assets";
          }
          const unit = count === 1 ? "asset" : "assets";
          return `${count} ${unit}`;
        }
        case "kits_list": {
          const count = Number.parseInt(attrs.count ?? "0", 10);
          if (!Number.isFinite(count) || count <= 0) {
            return "kits";
          }
          const unit = count === 1 ? "kit" : "kits";
          return `${count} ${unit}`;
        }
        case "booking_status": {
          const status = attrs.status ?? "";
          return decodeHtmlEntities(status);
        }
        case "description": {
          const oldText = decodeHtmlEntities(attrs.oldText ?? "");
          const newText = decodeHtmlEntities(attrs.newText ?? "");
          if (oldText && newText) {
            return `${oldText} -> ${newText}`;
          }
          return newText || oldText;
        }
        default: {
          const textAttr = attrs.text ?? "";
          return textAttr ? decodeHtmlEntities(textAttr) : "";
        }
      }
    }
  );

/**
 * Strips Markdoc tags from a note and formats any `{% date %}` tags with the
 * caller's resolved date/time preferences.
 *
 * @param content - Raw note content (may contain Markdoc tags + markdown)
 * @param prefs - Fully-resolved format prefs (acting user for exports/PDFs)
 * @returns Plain, human-readable text safe for CSV/PDF rendering
 */
export const sanitizeNoteContent = (
  content: string,
  prefs: ResolvedFormatPrefs
): string => {
  if (!content) return "";

  const withoutMarkdoc = sanitizeMarkdocTags(content, prefs);
  const decodedEntities = decodeHtmlEntities(withoutMarkdoc);

  return cleanMarkdownFormatting(decodedEntities, {
    preserveLineBreaks: true,
  });
};
