/**
 * Encoding of raw attribute values in stored Markdoc note content.
 *
 * The note wrappers in `~/utils/markdoc-wrappers` splice user text into quoted
 * tag attributes as-is: line breaks, tabs and backslashes are stored raw, and
 * only `"` is escaped (as `&quot;`). Markdoc's string grammar refuses that
 * text. A string may not contain a control character (`\n`, `\r`, `\t`), and a
 * backslash must start one of its escapes (`\\`, `\"`, `\n`, `\r`, `\t`). A
 * tag holding either does not parse at all, so the note renders with a hole
 * where the tag should be: "updated the asset description ." for any
 * multi-line description, or a missing user link for a name like
 * `Customer\Barbara`.
 *
 * Stored content keeps the raw form, and this module converts it into valid
 * Markdoc right before parsing. Raw is the one encoding every reader of
 * stored notes already understands: the CSV/PDF export
 * (`~/utils/note-sanitizer.server`) and the companion app's activity list
 * read attribute values with plain regexes, so writing Markdoc escapes
 * instead would show `\n` and `\\` there. Content already in the database
 * is in the raw form as well.
 *
 * No note writer emits Markdoc escapes, so every backslash inside a stored
 * attribute value is one the user typed and is encoded as a literal backslash.
 *
 * @see {@link file://./markdoc-wrappers.ts} the writers
 * @see {@link file://./../components/markdown/markdown-viewer.tsx} the caller
 */

const OPEN = "{%";
const CLOSE = "%}";

/**
 * Encodes one character of a quoted attribute value as Markdoc string syntax.
 *
 * Line breaks become `\n` (a `\r\n` pair is collapsed by the caller), tabs
 * `\t`, and a backslash `\\`. Any other control character has no Markdoc
 * escape and becomes a space.
 */
function encodeStringChar(char: string): string {
  switch (char) {
    case "\\":
      return "\\\\";
    case "\n":
    case "\r":
      return "\\n";
    case "\t":
      return "\\t";
    default:
      return char < " " ? " " : char;
  }
}

/**
 * Encodes the tag that opens at `start`, up to and including its `%}`.
 *
 * Quote handling mirrors Markdoc's own `findTagEnd`, so a `%}` inside a quoted
 * value does not end the tag, except that a backslash never escapes the quote
 * after it: stored values never contain an escaped quote, so a `"` always
 * closes the value.
 *
 * @returns The encoded tag and the index just past it, or `null` when the tag
 *   is never closed
 */
function encodeTagAt(
  content: string,
  start: number
): { text: string; end: number } | null {
  let text = OPEN;
  let inString = false;

  for (let pos = start + OPEN.length; pos < content.length; pos++) {
    const char = content[pos];

    if (inString) {
      if (char === '"') {
        inString = false;
        text += char;
      } else {
        text += encodeStringChar(char);
        // A Windows line break is one break, not two.
        if (char === "\r" && content[pos + 1] === "\n") pos++;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      text += char;
    } else if (content.startsWith(CLOSE, pos)) {
      return { text: text + CLOSE, end: pos + CLOSE.length };
    } else {
      text += char;
    }
  }

  return null;
}

/**
 * Converts the raw attribute values of every Markdoc tag in stored note
 * content into valid Markdoc strings, leaving all text outside the tags
 * untouched.
 *
 * Content whose tags are already valid comes back unchanged, unless an
 * attribute value holds a backslash, which is kept as a literal backslash
 * rather than read as an escape. A `{%` that is never closed, and everything
 * after it, is left as it was.
 *
 * @param content - Note content as stored in the database
 * @returns The content with every quoted tag attribute value Markdoc-encoded
 */
export function encodeRawTagAttributeValues(content: string): string {
  if (!content.includes(OPEN)) return content;

  let output = "";
  let pos = 0;

  while (pos < content.length) {
    const start = content.indexOf(OPEN, pos);
    if (start === -1) break;

    const tag = encodeTagAt(content, start);
    if (!tag) break;

    output += content.slice(pos, start) + tag.text;
    pos = tag.end;
  }

  return output + content.slice(pos);
}
