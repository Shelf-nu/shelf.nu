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
 * Pure (no React Native, Expo or `@/` imports) so it runs under Node's test
 * runner.
 *
 * @see {@link file://./../components/asset-detail/notes-section.tsx}
 */

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
