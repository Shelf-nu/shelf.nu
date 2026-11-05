/**
 * Reads an activity note's Markdoc source as one line of plain text for the
 * asset screen's notes list.
 *
 * Notes come from the webapp as stored, with its Markdoc tags (`link`, `name`,
 * `date`, `booking_status`, lists and badges). Each known tag becomes the words
 * it shows on the web. A tag this build does not know yet shows its `text`,
 * `value` or `name` attribute, so a tag the webapp adds later still reads as
 * its words instead of leaving a gap in the sentence.
 *
 * `markdocToSegments` reads the same note as text and link runs: each `link`
 * tag the app has a screen for (a booking, kit or asset the note names)
 * links to it, one it has none for (a person) stays text, a value someone
 * typed stays text, a comment's
 * Markdown `[label](https://...)` link reads as its label, and every other
 * URL or bare domain in the text links as typed.
 *
 * Pure (no React Native, Expo or `@/` imports) so it runs under Node's test
 * runner.
 *
 * @see {@link file://./../components/asset-detail/notes-section.tsx}
 * @see {@link file://./text-links.ts} `findTextLinks`
 */

import { segmentText, type TextSegment } from "@shelf/links";
import { opensInApp } from "./open-link";
import { findTextLinks } from "./text-links";

/** How the caller formats the parts that depend on the user's preferences. */
export interface NoteTextFormatters {
  /** A `date` tag's ISO value in the user's date format and timezone. */
  date: (iso: string) => string;
  /** A `booking_status` tag's status, as the app labels it. */
  status: (status: string) => string;
}

/** The words an unknown tag carries, in the order they are looked for. */
const FALLBACK_ATTRIBUTE = /\b(?:text|value|name)="([^"]*)"/;

/**
 * A Markdoc tag's attributes, as one capture group: `key="value"` pairs
 * (the value may hold any character but a quote, `%` included, because the
 * web app strips only whole `{%` and `%}` from typed values) and bare
 * `key=value` pairs (`count=3`, `chips=true`).
 */
const ATTRIBUTES = String.raw`((?:[A-Za-z_][\w-]*=(?:"[^"]*"|[^\s"%/}]+)\s*)*)`;

/**
 * Matches a self-closing Markdoc tag by name, attributes in group 1.
 *
 * @param names - A tag name, or names joined with `|`.
 * @returns A global pattern for `{% <name> <attributes> /%}`.
 */
function tagPattern(names: string): RegExp {
  return new RegExp(String.raw`{%\s*(?:${names})\s+${ATTRIBUTES}\/%}`, "g");
}

/** Any self-closing Markdoc tag, attributes in group 1. */
const ANY_TAG = new RegExp(
  String.raw`{%\s*[A-Za-z_][\w-]*\s*${ATTRIBUTES}\/%}`,
  "g"
);

/** A Markdoc tag left unread, which never links whatever it holds. */
const UNREAD_TAG = /{%[\s\S]*?%}/g;

/**
 * Converts Markdoc tag syntax in note content to readable plain text.
 *
 * @param content - The note's stored Markdoc source
 * @param format - Date and status formatting from the user's preferences
 * @returns The note as one line of plain text
 */
export function markdocToPlainText(
  content: string,
  format: NoteTextFormatters
): string {
  /** Replaces a tag by `read(attributes)`, or keeps it when that is null. */
  const readTag =
    (read: (attributes: string) => string | null | undefined) =>
    (tag: string, attributes: string) =>
      read(attributes) ?? tag;

  return (
    content
      // {% link to="..." text="Display Text" /%} -> Display Text
      .replace(
        tagPattern("link"),
        readTag((a) => tagAttribute(a, "text"))
      )
      // {% name text="Shoot 2" /%} -> Shoot 2 (a value a person typed)
      .replace(
        tagPattern("name"),
        readTag((a) => tagAttribute(a, "text"))
      )
      // {% date value="2024-01-01T..." /%} -> date in the user's format + timezone
      .replace(
        tagPattern("date"),
        readTag((a) => {
          const iso = tagAttribute(a, "value");
          if (iso === undefined) return null;
          try {
            return format.date(iso);
          } catch {
            return iso;
          }
        })
      )
      // {% category_badge name="..." /%} and {% tag name="..." /%} -> name
      .replace(
        tagPattern("category_badge|tag"),
        readTag((a) => tagAttribute(a, "name"))
      )
      // {% booking_status status="RESERVED" ... /%} -> Reserved
      .replace(
        tagPattern("booking_status"),
        readTag((a) => {
          const status = tagAttribute(a, "status");
          return status === undefined ? null : format.status(status);
        })
      )
      // {% assets_list count=3 ... action="added" /%} -> 3 assets added
      // {% kits_list count=2 ... action="added" /%} -> 2 kits added
      .replace(
        tagPattern("assets_list|kits_list"),
        (tag, attributes: string) => {
          const count = /\bcount=(\d+)/.exec(attributes)?.[1];
          const action = tagAttribute(attributes, "action");
          if (count === undefined || action === undefined) return tag;
          const noun = tag.includes("kits_list") ? "kits" : "assets";
          return `${count} ${noun} ${action}`;
        }
      )
      // {% description newText="..." /%} -> (description updated)
      .replace(tagPattern("description"), "(description updated)")
      // Any other tag shows the words it carries, or nothing if it has none
      .replace(ANY_TAG, (tag) => FALLBACK_ATTRIBUTE.exec(tag)?.[1] ?? "")
      // Strip **bold** markers
      .replace(/\*\*/g, "")
      // Clean up &quot; entities
      .replace(/&quot;/g, '"')
      // Clean up extra whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** A Markdoc `link` tag, with its attributes in group 1. */
const LINK_TAG = tagPattern("link");

/**
 * A Markdoc `category_badge` or `tag` badge, with its attributes in group 1.
 * Its `name` is a value someone typed, shown as badge text on the web.
 */
const BADGE_TAG = tagPattern("category_badge|tag");

/** A Markdoc `name` tag, with its attributes in group 1. */
const NAME_TAG = tagPattern("name");

/**
 * A Markdown link to an http(s) URL: label in group 1, URL in group 2. The
 * URL may hold balanced parentheses (`.../Mercury_(planet)`).
 */
const MARKDOWN_LINK =
  /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gi;

/**
 * Stand-in for a held run while the rest of the note is flattened: a
 * private-use character pair around the run's index, which no step of
 * `markdocToPlainText` rewrites. The same characters typed into a note are
 * held as text before anything else, so every stand-in is a generated one.
 */
const HELD_RUN = /\uE000(\d+)\uE001/g;

/** One attribute of a Markdoc tag, or undefined when the tag has none. */
function tagAttribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
}

/** Text from a tag attribute or a Markdown label, cleaned like a note. */
function cleanRunText(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ");
}

/**
 * `to` resolved against the Shelf server, when that makes a page on that
 * server. A `link` tag names a Shelf page, so a `to` on any other host
 * opens nothing.
 */
function shelfPageUrl(to: string, shelfBaseUrl: string): string | null {
  try {
    const base = new URL(shelfBaseUrl);
    const url = new URL(to, base);
    return url.origin === base.origin ? url.href : null;
  } catch {
    return null;
  }
}

/** How much of a note may link outside Shelf. */
export interface NoteLinkOptions {
  /**
   * True for a comment a person wrote, whose Markdown `[label](url)` links
   * read as their label. False for a system note, where any Markdown in it
   * came from a value someone typed (a name, a custom field value) and must
   * not become a link that hides where it goes. The web app draws the same
   * line (`allowExternalLinks` on comments only).
   */
  allowExternalLinks: boolean;
}

/**
 * Reads an activity note as text and link runs, for a note shown with
 * tappable links.
 *
 * - A `link` tag links to the app screen for its page on the connected
 *   Shelf server. A page the app has no screen for (a team member) reads as
 *   its text: the in-app browser holds no Shelf session, so it would only
 *   show the web login.
 * - A `category_badge` or `tag` badge reads as its name, plain text.
 * - A `name` tag (a value someone typed) is plain text, unless the note's
 *   writer marked it `chips=true` (a custom field value), whose http(s)
 *   URLs link as typed, as on the web.
 * - A Markdown link reads as its label and links, in comments only.
 * - Every other URL or bare domain in the text links as typed.
 *
 * @param content - The note's stored Markdoc source
 * @param format - Date and status formatting from the user's preferences
 * @param shelfBaseUrl - Base URL of the connected Shelf server; a `link`
 *   tag's relative `to` resolves against it
 * @param options - Whether the note may link outside Shelf
 * @returns The runs in order; their `text` joined reads exactly as
 *   `markdocToPlainText` does, except that a Markdown link reads as its label
 */
export function markdocToSegments(
  content: string,
  format: NoteTextFormatters,
  shelfBaseUrl: string,
  options: NoteLinkOptions
): readonly TextSegment[] {
  const held: (readonly TextSegment[])[] = [];
  const hold = (...runs: readonly TextSegment[]) =>
    `\uE000${held.push(runs) - 1}\uE001`;

  let source = content
    // The stand-in characters a note types itself are held as text first,
    // so every stand-in left in the note is one this function made.
    .replace(/[\uE000\uE001]/g, (character) =>
      hold({ type: "text", text: character })
    )
    .replace(LINK_TAG, (tag, attributes: string) => {
      const text = tagAttribute(attributes, "text");
      const to = tagAttribute(attributes, "to");
      const url = to === undefined ? null : shelfPageUrl(to, shelfBaseUrl);
      if (text === undefined || url === null) return tag;
      return opensInApp(url, shelfBaseUrl)
        ? hold({ type: "link", text: cleanRunText(text), url })
        : hold({ type: "text", text: cleanRunText(text) });
    })
    .replace(BADGE_TAG, (tag, attributes: string) => {
      const name = tagAttribute(attributes, "name");
      return name === undefined
        ? tag
        : hold({ type: "text", text: cleanRunText(name) });
    })
    .replace(NAME_TAG, (tag, attributes: string) => {
      const text = tagAttribute(attributes, "text");
      if (text === undefined) return tag;
      // A value marked chips=true (a custom field value) links its http(s)
      // URLs, exactly as the field itself does on the phone and the web;
      // any other typed value is plain text. The flag is read with the
      // typed text taken out, so a name that spells it out stays text.
      const flags = attributes.replace(/\btext="[^"]*"/g, "");
      return /\bchips=true\b/.test(flags)
        ? hold(...segmentText(cleanRunText(text)))
        : hold({ type: "text", text: cleanRunText(text) });
    });
  if (options.allowExternalLinks) {
    source = source.replace(
      MARKDOWN_LINK,
      (match, text: string, url: string) =>
        isWebUrl(url)
          ? hold({ type: "link", text: cleanRunText(text), url })
          : match
    );
  }

  const plain = markdocToPlainText(source, format);
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of plain.matchAll(HELD_RUN)) {
    const runs = held[Number(match[1])];
    if (runs === undefined) continue;
    if (match.index > cursor) {
      segments.push(...linkPlainText(plain.slice(cursor, match.index)));
    }
    segments.push(...runs);
    cursor = match.index + match[0].length;
  }
  if (cursor < plain.length) {
    segments.push(...linkPlainText(plain.slice(cursor)));
  }
  return collapseBoundaries(segments);
}

/**
 * Links the URLs and domains in a stretch of a note's plain text. A tag
 * still in it (one no reader understood) stays text, so a value typed into
 * its attributes never becomes a link.
 */
function linkPlainText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(UNREAD_TAG)) {
    if (match.index > cursor) {
      segments.push(...findTextLinks(text.slice(cursor, match.index)));
    }
    segments.push({ type: "text", text: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push(...findTextLinks(text.slice(cursor)));
  return segments;
}

/** Whether a URL parses as an http(s) URL, as `resolveLinkOpening` needs. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Collapses the whitespace where runs meet, the way `markdocToPlainText`
 * collapses it inside one string: no space at the start or end of the note
 * and never two in a row across a run boundary. A run's own text is left
 * alone otherwise, so "Sam" next to " Lee" still reads "Sam Lee".
 */
function collapseBoundaries(segments: readonly TextSegment[]): TextSegment[] {
  const out: TextSegment[] = [];
  let endsWithSpace = true;
  for (const segment of segments) {
    let text = segment.text;
    if (endsWithSpace) text = text.replace(/^\s+/, "");
    if (text === "") continue;
    const previous = out[out.length - 1];
    // Neighbouring text runs read as one run, so a held name and the words
    // around it render as a single piece of text.
    if (segment.type === "text" && previous?.type === "text") {
      out[out.length - 1] = { ...previous, text: previous.text + text };
    } else {
      out.push({ ...segment, text });
    }
    endsWithSpace = /\s$/.test(text);
  }
  const last = out[out.length - 1];
  if (last && endsWithSpace) {
    const text = last.text.replace(/\s+$/, "");
    if (text === "") out.pop();
    else out[out.length - 1] = { ...last, text };
  }
  return out;
}
