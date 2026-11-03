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
 * the connected Shelf server, a Markdown `[label](https://...)` link reads as
 * its label, and every other URL or bare domain in the text links as typed.
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

/** A Markdown link to an http(s) URL: label in group 1, URL in group 2. */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi;

/**
 * Stand-in for a held link while the rest of the note is flattened: a
 * private-use character pair around the link's index, which no note contains
 * and no step of `markdocToPlainText` rewrites.
 */
const HELD_LINK = /\uE000(\d+)\uE001/g;

/** One attribute of a Markdoc tag, or undefined when the tag has none. */
function tagAttribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
}

/** `to` resolved against the Shelf server, when that makes an http(s) URL. */
function absoluteUrl(to: string, shelfBaseUrl: string): string | null {
  try {
    const url = new URL(to, shelfBaseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads an activity note as text and link runs, for a note shown with
 * tappable links.
 *
 * @param content - The note's stored Markdoc source
 * @param format - Date and status formatting from the user's preferences
 * @param shelfBaseUrl - Base URL of the connected Shelf server; a `link`
 *   tag's relative `to` resolves against it
 * @returns The runs in order; their `text` joined reads exactly as
 *   `markdocToPlainText` does, except that a Markdown link reads as its label
 */
export function markdocToSegments(
  content: string,
  format: NoteTextFormatters,
  shelfBaseUrl: string
): readonly TextSegment[] {
  const held: { text: string; url: string }[] = [];
  const hold = (text: string, url: string) =>
    `\uE000${held.push({ text, url }) - 1}\uE001`;

  const withHeldLinks = content
    .replace(LINK_TAG, (tag, attributes: string) => {
      const text = tagAttribute(attributes, "text");
      const to = tagAttribute(attributes, "to");
      const url = to === undefined ? null : absoluteUrl(to, shelfBaseUrl);
      if (text === undefined || url === null) return tag;
      return hold(text.replace(/&quot;/g, '"'), url);
    })
    .replace(MARKDOWN_LINK, (_match, text: string, url: string) =>
      hold(text.replace(/\*\*/g, ""), url)
    );

  const plain = markdocToPlainText(withHeldLinks, format);
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of plain.matchAll(HELD_LINK)) {
    if (match.index > cursor) {
      segments.push(...findTextLinks(plain.slice(cursor, match.index)));
    }
    const link = held[Number(match[1])];
    segments.push({ type: "link", text: link.text, url: link.url });
    cursor = match.index + match[0].length;
  }
  if (cursor < plain.length) {
    segments.push(...findTextLinks(plain.slice(cursor)));
  }
  return segments;
}
