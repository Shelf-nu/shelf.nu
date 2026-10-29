/**
 * Public types of `@shelf/links`.
 *
 * @see {@link file://./index.ts} for the functions that produce them.
 */

/** A file-sharing service recognised by its host. Shown on chips by name. */
export type LinkProvider =
  | "sharepoint"
  | "onedrive"
  | "google-drive"
  | "google-docs"
  | "dropbox"
  | "box";

/**
 * What the URL alone says the link points at. `page` means nothing more
 * specific is known (a shop page, a maker's product page).
 */
export type LinkKind =
  | "pdf"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "form"
  | "folder"
  | "image"
  | "video"
  | "archive"
  | "file"
  | "page";

/**
 * Every icon a chip can show: one per kind, and the generic `link` icon for a
 * `page`. Chips never show brand marks; the provider is named in text.
 */
export type LinkIconId = Exclude<LinkKind, "page"> | "link";

declare const linkKeyBrand: unique symbol;

/**
 * A link's identity for stored titles: the parsed URL without its `#fragment`
 * and without Shelf's own `ref=shelf-webapp` / `ref=shelf-companion` query
 * parameter, every other parameter kept in order. Only `parseLink` makes one.
 */
export type LinkKey = string & { readonly [linkKeyBrand]: true };

/** A value that is exactly one http(s) URL, read for display. */
export interface ParsedLink {
  /** The trimmed URL as stored: always http(s), at most `MAX_LINK_LENGTH`. */
  readonly url: string;
  readonly key: LinkKey;
  /** Lowercased host name without a leading "www." and without the port. */
  readonly host: string;
  readonly provider: LinkProvider | null;
  readonly kind: LinkKind;
  /**
   * Decoded last path segment (or the `file=` query parameter) when it ends in
   * a known document extension, made safe to display; otherwise null.
   */
  readonly fileName: string | null;
  readonly icon: LinkIconId;
}

/** One run of a text value: plain text, or a URL found inside it. */
export type TextSegment =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "link";
      /** The characters of the value that form the URL. */
      readonly text: string;
      /** The http(s) URL to open; validated by the URL parser. */
      readonly url: string;
    };

/** Result of the Link-format input rule. */
export type LinkInput =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly message: string };

/** API contract: what the server knows about a link in one workspace. */
export interface LinkTitle {
  /** Title read from the page itself, already cleaned. */
  readonly pageTitle: string | null;
  /** Name a person gave the link in this workspace; wins over `pageTitle`. */
  readonly customTitle: string | null;
}

/** Titles keyed by `LinkKey`. JSON turns the brand into a plain string key. */
export type LinkTitles = Readonly<Record<string, LinkTitle>>;

/** The words on a link chip. */
export interface ChipText {
  /** The main line: a title, a file name, the kind, or the host. */
  readonly primary: string;
  /** Secondary line such as "PDF · Dropbox"; null when it adds nothing. */
  readonly meta: string | null;
  /** Accessible name for the whole chip, e.g. "Manual.pdf, PDF, Dropbox". */
  readonly label: string;
}

/**
 * One icon as SVG path data on a 24x24 grid. Draw every path with
 * `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`,
 * `stroke-linecap="round"` and `stroke-linejoin="round"`.
 */
export interface LinkIconData {
  readonly viewBox: string;
  readonly paths: readonly string[];
}
