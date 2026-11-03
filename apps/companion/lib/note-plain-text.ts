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
 * tag (a booking, kit, asset or person the note names) links to its page on
 * the connected Shelf server, a value someone typed stays text, a comment's
 * Markdown `[label](https://...)` link reads as its label, and every other
 * URL or bare domain in the text links as typed.
 *
 * Pure (no React Native, Expo or `@/` imports) so it runs under Node's test
 * runner.
 *
 * @see {@link file://./../components/asset-detail/notes-section.tsx}
 * @see {@link file://./text-links.ts} `findTextLinks`
 */

import type { TextSegment } from "@shelf/links";
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
  return (
    content
      // {% link to="..." text="Display Text" /%} -> Display Text
      .replace(/{%\s*link\s+[^%]*?text="([^"]*)"[^%]*\/%}/g, "$1")
      // {% name text="Shoot 2" /%} -> Shoot 2 (a value a person typed)
      .replace(/{%\s*name\s+[^%]*?text="([^"]*)"[^%]*\/%}/g, "$1")
      // {% date value="2024-01-01T..." /%} -> date in the user's format + timezone
      .replace(
        /{%\s*date\s+value="([^"]*)"[^%]*\/%}/g,
        (_match, iso: string) => {
          try {
            return format.date(iso);
          } catch {
            return iso;
          }
        }
      )
      // {% category_badge name="..." ... /%} -> name
      .replace(/{%\s*category_badge\s+name="([^"]*)"[^%]*\/%}/g, "$1")
      // {% tag name="..." ... /%} -> name
      .replace(/{%\s*tag\s+name="([^"]*)"[^%]*\/%}/g, "$1")
      // {% booking_status status="RESERVED" ... /%} -> Reserved
      .replace(
        /{%\s*booking_status\s+status="([^"]*)"[^%]*\/%}/g,
        (_match, status: string) => format.status(status)
      )
      // {% assets_list count=3 ... action="added" /%} -> 3 assets added
      .replace(
        /{%\s*assets_list\s+count=(\d+)[^%]*action="([^"]*)"[^%]*\/%}/g,
        "$1 assets $2"
      )
      // {% kits_list count=2 ... action="added" /%} -> 2 kits added
      .replace(
        /{%\s*kits_list\s+count=(\d+)[^%]*action="([^"]*)"[^%]*\/%}/g,
        "$1 kits $2"
      )
      // {% description newText="..." /%} -> (description updated)
      .replace(/{%\s*description[^%]*\/%}/g, "(description updated)")
      // Any other tag shows the words it carries, or nothing if it has none
      .replace(/{%[^%]*\/%}/g, (tag) => FALLBACK_ATTRIBUTE.exec(tag)?.[1] ?? "")
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
const LINK_TAG = /{%\s*link\s+([^%]*?)\/%}/g;

/** A Markdoc `name` tag, with its attributes in group 1. */
const NAME_TAG = /{%\s*name\s+([^%]*?)\/%}/g;

/**
 * A Markdown link to an http(s) URL: label in group 1, URL in group 2. The
 * URL may hold balanced parentheses (`.../Mercury_(planet)`).
 */
const MARKDOWN_LINK =
  /\[([^\]\n]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/gi;

/**
 * Stand-in for a held run while the rest of the note is flattened: a
 * private-use character pair around the run's index, which no note contains
 * and no step of `markdocToPlainText` rewrites.
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
 * - A `link` tag links to its page on the connected Shelf server.
 * - A `name` tag (a value someone typed) is plain text, unless the note's
 *   writer marked it `chips=true` (a custom field value), whose URLs link
 *   as typed, as on the web.
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
  const held: TextSegment[] = [];
  const hold = (run: TextSegment) => `\uE000${held.push(run) - 1}\uE001`;

  let source = content
    .replace(LINK_TAG, (tag, attributes: string) => {
      const text = tagAttribute(attributes, "text");
      const to = tagAttribute(attributes, "to");
      const url = to === undefined ? null : shelfPageUrl(to, shelfBaseUrl);
      if (text === undefined || url === null) return tag;
      return hold({ type: "link", text: cleanRunText(text), url });
    })
    .replace(NAME_TAG, (tag, attributes: string) => {
      const text = tagAttribute(attributes, "text");
      if (text === undefined || /\bchips=true\b/.test(attributes)) return tag;
      return hold({ type: "text", text: cleanRunText(text) });
    });
  if (options.allowExternalLinks) {
    source = source.replace(
      MARKDOWN_LINK,
      (_match, text: string, url: string) =>
        hold({ type: "link", text: cleanRunText(text), url })
    );
  }

  const plain = markdocToPlainText(source, format);
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of plain.matchAll(HELD_RUN)) {
    if (match.index > cursor) {
      segments.push(...findTextLinks(plain.slice(cursor, match.index)));
    }
    segments.push(held[Number(match[1])]);
    cursor = match.index + match[0].length;
  }
  if (cursor < plain.length) {
    segments.push(...findTextLinks(plain.slice(cursor)));
  }
  return segments;
}
