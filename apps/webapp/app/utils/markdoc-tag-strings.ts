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
 * Markdoc right before parsing, for system-generated notes only
 * (`SystemNoteViewer`). Author-written content is left alone: a Markdoc
 * example in a code span must show exactly as typed. Raw is the one encoding
 * every reader of stored notes already understands: the CSV/PDF export
 * (`~/utils/note-sanitizer.server`) and the companion app's activity list
 * read attribute values with plain regexes, so writing Markdoc escapes
 * instead would show `\n` and `\\` there. Content already in the database
 * is in the raw form as well.
 *
 * Only tags with exactly the shape the writers produce are encoded (see
 * `writerTagEnd`). No writer emits Markdoc escapes or a `"` inside a value, so
 * every backslash inside such a value is one the user typed and is encoded as
 * a literal backslash. Anything else, such as a stray `{%` in plain text or a
 * value holding a Markdoc-style `\"`, is not writer-shaped and is left exactly
 * as stored, so Markdoc sees the original text.
 *
 * The scan is linear in the content length, including on hostile input: a
 * candidate tag fails at its first character that breaks the writer shape,
 * and the results of the attribute scan are cached per position.
 *
 * @see {@link file://./markdoc-wrappers.ts} the writers
 * @see {@link file://./../components/markdown/system-note-viewer.tsx} the caller
 */

const OPEN = "{%";
const CLOSE = "%}";

/** Whitespace a writer may put between the parts of a tag. */
function isSpace(code: number): boolean {
  // Space, tab, line feed, vertical tab, form feed, carriage return.
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

/** A tag name character: `[a-z_]`. */
function isTagNameChar(code: number): boolean {
  return (code >= 0x61 && code <= 0x7a) || code === 0x5f;
}

/** The first character of an attribute name: `[A-Za-z_]`. */
function isAttrNameStart(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x41 && code <= 0x5a) ||
    code === 0x5f
  );
}

/** A later character of an attribute name: `[A-Za-z0-9_]`. */
function isAttrNameChar(code: number): boolean {
  return isAttrNameStart(code) || (code >= 0x30 && code <= 0x39);
}

/** A bare (unquoted) value character: anything but whitespace, `"`, `%`, `/`, `}`. */
function isBareValueChar(code: number): boolean {
  return (
    !Number.isNaN(code) &&
    !isSpace(code) &&
    code !== 0x22 &&
    code !== 0x25 &&
    code !== 0x2f &&
    code !== 0x7d
  );
}

/** True when `content` holds a backslash or a control character. */
function hasEncodableChar(content: string): boolean {
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    if (code < 0x20 || code === 0x5c) return true;
  }
  return false;
}

/**
 * Scan state shared by every candidate tag in one piece of content.
 *
 * `tailEnd` caches, per position just after a tag name or an attribute value,
 * where the rest of the tag ends (`-1` when it never closes in writer shape).
 * The rest of a tag depends only on that position, so each one is scanned
 * once however many `{%` lead to it. `noQuoteAfter` is the lowest position
 * from which no `"` follows, so a later quoted value at or past it fails
 * without another search.
 */
type ScanState = {
  tailEnd: Map<number, number>;
  noQuoteAfter: number;
};

/**
 * Finds the end of a tag's remaining attributes and closing delimiter,
 * starting just after its name or one of its attribute values.
 *
 * Grammar from `pos`: zero or more of (whitespace, attribute name, `=`,
 * value), then optional whitespace, optional `/`, optional whitespace, `%}`.
 * A value is a `"` up to the next `"`, or a run of bare value characters.
 *
 * @returns The index just past the closing `%}`, or `-1` when the text from
 *   `pos` is not writer-shaped
 */
function tagTailEnd(content: string, pos: number, state: ScanState): number {
  // Positions visited on this walk; they all share its result.
  const visited: number[] = [];
  let result = -1;
  let i = pos;

  for (;;) {
    const cached = state.tailEnd.get(i);
    if (cached !== undefined) {
      result = cached;
      break;
    }
    visited.push(i);

    const wsStart = i;
    while (i < content.length && isSpace(content.charCodeAt(i))) i++;

    if (i > wsStart && isAttrNameStart(content.charCodeAt(i))) {
      i++;
      while (i < content.length && isAttrNameChar(content.charCodeAt(i))) i++;
      if (content[i] !== "=") break;
      i++;

      if (content[i] === '"') {
        if (i + 1 >= state.noQuoteAfter) break;
        const closingQuote = content.indexOf('"', i + 1);
        if (closingQuote === -1) {
          state.noQuoteAfter = i + 1;
          break;
        }
        i = closingQuote + 1;
      } else {
        const valueStart = i;
        while (isBareValueChar(content.charCodeAt(i))) i++;
        if (i === valueStart) break;
      }
      // `i` is now just past a value: the start of the next tail.
      continue;
    }

    if (content[i] === "/") {
      i++;
      while (i < content.length && isSpace(content.charCodeAt(i))) i++;
    }
    if (content.startsWith(CLOSE, i)) result = i + CLOSE.length;
    break;
  }

  for (const position of visited) state.tailEnd.set(position, result);
  return result;
}

/**
 * Finds the end of the writer-shaped tag that opens at `start`.
 *
 * Writer shape: `{%`, optional whitespace, optional `/`, a tag name of
 * `[a-z_]`, then the attributes and closing delimiter read by `tagTailEnd`.
 * A quoted value runs to the next `"`, because writers never store a `"`
 * inside a value. A value holding a Markdoc-style `\"` therefore ends early
 * and leaves text that breaks the shape, so that tag is not writer-shaped.
 *
 * @returns The index just past the tag's `%}`, or `-1` when the text at
 *   `start` is not a writer-shaped tag
 */
function writerTagEnd(
  content: string,
  start: number,
  state: ScanState
): number {
  let i = start + OPEN.length;
  while (i < content.length && isSpace(content.charCodeAt(i))) i++;
  if (content[i] === "/") i++;

  const nameStart = i;
  while (i < content.length && isTagNameChar(content.charCodeAt(i))) i++;
  if (i === nameStart) return -1;

  return tagTailEnd(content, i, state);
}

/**
 * Encodes the quoted attribute values of a writer-shaped tag.
 *
 * Every `"` in such a tag delimits a value, so the quotes simply toggle
 * between tag syntax and value text. Inside a value a backslash becomes `\\`,
 * a line break `\n` (a `\r\n` pair is one break), a tab `\t`, and any other
 * control character, which has no Markdoc escape, a space.
 */
function encodeTag(tag: string): string {
  let text = "";
  let inString = false;

  for (let i = 0; i < tag.length; i++) {
    const char = tag[i];

    if (char === '"') {
      inString = !inString;
      text += char;
    } else if (!inString) {
      text += char;
    } else if (char === "\\") {
      text += "\\\\";
    } else if (char === "\n") {
      text += "\\n";
    } else if (char === "\r") {
      text += "\\n";
      if (tag[i + 1] === "\n") i++;
    } else if (char === "\t") {
      text += "\\t";
    } else {
      text += char < " " ? " " : char;
    }
  }

  return text;
}

/**
 * Converts the raw attribute values of every writer-shaped Markdoc tag in
 * stored note content into valid Markdoc strings.
 *
 * Text outside those tags is never changed. A `{%` that does not open a
 * writer-shaped tag (unclosed, malformed, or holding a Markdoc-style `\"`) is
 * copied through as stored, and the search continues right after it, so later
 * tags are still encoded. Content with no `{%`, or with no backslash and no
 * control character, is returned as the very same string.
 *
 * @param content - Note content as stored in the database
 * @returns The content with every writer-shaped tag's quoted values
 *   Markdoc-encoded
 */
export function encodeRawTagAttributeValues(content: string): string {
  if (!content.includes(OPEN) || !hasEncodableChar(content)) return content;

  const state: ScanState = {
    tailEnd: new Map(),
    noQuoteAfter: content.length + 1,
  };
  let output = "";
  let pos = 0;
  let searchFrom = 0;

  for (;;) {
    const start = content.indexOf(OPEN, searchFrom);
    if (start === -1) break;

    const end = writerTagEnd(content, start, state);
    if (end === -1) {
      // Not a writer tag: leave its `{%` as stored and look again after it.
      searchFrom = start + OPEN.length;
      continue;
    }

    output += content.slice(pos, start) + encodeTag(content.slice(start, end));
    pos = end;
    searchFrom = end;
  }

  return output + content.slice(pos);
}
