export type CleanMarkdownFormattingOptions = {
  preserveLineBreaks?: boolean;
};

/**
 * Cleans markdown formatting from a text string
 * @param text - Text containing markdown to clean
 * @param options - Behaviour modifiers
 * @returns Plain text with markdown formatting removed
 */
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

const createDateOnlyFormatter = (formatter: Intl.DateTimeFormat) => {
  const { locale, timeZone, numberingSystem, calendar } =
    formatter.resolvedOptions();

  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
  };

  if (timeZone) options.timeZone = timeZone;
  if (numberingSystem) options.numberingSystem = numberingSystem;
  if (calendar) options.calendar = calendar;

  return new Intl.DateTimeFormat(locale, options);
};

const sanitizeMarkdocTags = (
  text: string,
  formatter: Intl.DateTimeFormat
): string => {
  const dateOnlyFormatter = createDateOnlyFormatter(formatter);

  return text.replace(
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
              ? formatter.format(parsedDate)
              : dateOnlyFormatter.format(parsedDate);
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
};

export const sanitizeNoteContent = (
  content: string,
  formatter: Intl.DateTimeFormat
): string => {
  if (!content) return "";

  const withoutMarkdoc = sanitizeMarkdocTags(content, formatter);
  const decodedEntities = decodeHtmlEntities(withoutMarkdoc);

  return cleanMarkdownFormatting(decodedEntities, {
    preserveLineBreaks: true,
  });
};
