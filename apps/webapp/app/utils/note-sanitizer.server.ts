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

const createDateOnlyFormatter = (formatter: Intl.DateTimeFormat) => {
  const resolved =
    typeof formatter.resolvedOptions === "function"
      ? formatter.resolvedOptions()
      : null;

  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
  };

  if (resolved?.timeZone) options.timeZone = resolved.timeZone;
  if (resolved?.numberingSystem)
    options.numberingSystem = resolved.numberingSystem;
  if (resolved?.calendar) options.calendar = resolved.calendar;

  const locale = resolved?.locale ?? "en-US";

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
