/**
 * Finding and reading web links in custom field values, and the input rule for
 * Link-format fields.
 */

import { capDisplayText, normalizeDisplayText } from "./display-text";
import { kindFromFileName, kindFromPath, providerForHost } from "./registry";
import type {
  LinkInput,
  LinkKey,
  LinkKind,
  ParsedLink,
  TextSegment,
} from "./types";

/** At most this many characters; longer values render as text and are never fetched. */
export const MAX_LINK_LENGTH = 2048;

/**
 * An explicit http(s) URL runs until whitespace or a character that cannot
 * appear unencoded in a URL someone pasted.
 */
const URL_CANDIDATE = /https?:\/\/[^\s<>"]+/gi;

/** Sentence punctuation that ends a pasted URL rather than belonging to it. */
const TRAILING_PUNCTUATION = ".,;:!?'\"";

/** Query parameters Shelf adds to the links it opens. */
const SHELF_REF_PARAMS: readonly string[] = [
  "ref=shelf-webapp",
  "ref=shelf-companion",
];

interface FoundLink {
  readonly index: number;
  readonly url: string;
  readonly parsed: URL;
}

/**
 * Drops trailing punctuation and closing brackets that have no opening partner
 * inside the URL, so "(see https://x.com/a)." yields "https://x.com/a" while
 * "https://en.wikipedia.org/wiki/Mercury_(planet)" stays whole.
 */
function trimUrlEnd(candidate: string): string {
  let parens = 0;
  let brackets = 0;
  for (const character of candidate) {
    if (character === "(") parens++;
    else if (character === ")") parens--;
    else if (character === "[") brackets++;
    else if (character === "]") brackets--;
  }
  let end = candidate.length;
  while (end > 0) {
    const last = candidate[end - 1];
    if (TRAILING_PUNCTUATION.includes(last)) {
      end--;
    } else if (last === ")" && parens < 0) {
      parens++;
      end--;
    } else if (last === "]" && brackets < 0) {
      brackets++;
      end--;
    } else {
      break;
    }
  }
  return candidate.slice(0, end);
}

/**
 * The parsed URL when `url` is a linkable http(s) URL, else null. The host is
 * lowercased here because the URL implementation Expo installs on the phone
 * keeps the host's case, and keys must match the server's.
 */
function readUrl(url: string): URL | null {
  if (url.length > MAX_LINK_LENGTH) return null;
  try {
    const parsed = new URL(url);
    const isWeb = parsed.protocol === "http:" || parsed.protocol === "https:";
    if (!isWeb || parsed.hostname === "") return null;
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed;
  } catch {
    return null;
  }
}

function findLinks(text: string): FoundLink[] {
  const found: FoundLink[] = [];
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const url = trimUrlEnd(match[0]);
    const parsed = readUrl(url);
    if (parsed) found.push({ index: match.index, url, parsed });
  }
  return found;
}

/**
 * Splits text into text and link runs. Detects explicit http(s) URLs only,
 * drops trailing `.,;:!?'"` and an unbalanced closing `)` or `]`, and keeps a
 * candidate that the URL parser rejects, or that is longer than
 * `MAX_LINK_LENGTH`, as text.
 */
export function segmentText(text: string): readonly TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const { index, url } of findLinks(text)) {
    if (index > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, index) });
    }
    segments.push({ type: "link", text: url, url });
    cursor = index + url.length;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }
  return segments;
}

function linkKey(parsed: URL): LinkKey {
  const keyUrl = new URL(parsed.href);
  keyUrl.hash = "";
  keyUrl.search = keyUrl.search
    .slice(1)
    .split("&")
    .filter((param) => !SHELF_REF_PARAMS.includes(param))
    .join("&");
  return keyUrl.href as LinkKey;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function fileNameOf(parsed: URL): string | null {
  const lastSegment = parsed.pathname.slice(
    parsed.pathname.lastIndexOf("/") + 1
  );
  const candidates = [
    decodePathSegment(lastSegment),
    parsed.searchParams.get("file") ?? "",
  ];
  for (const candidate of candidates) {
    const name = capDisplayText(normalizeDisplayText(candidate));
    if (kindFromFileName(name)) return name;
  }
  return null;
}

/**
 * Reads a value that is exactly one http(s) URL (after trimming); null for
 * anything else, including text around a URL and URLs that end in sentence
 * punctuation.
 */
export function parseLink(value: string): ParsedLink | null {
  const url = value.trim();
  const [first] = findLinks(url);
  if (!first || first.index !== 0 || first.url !== url) return null;

  const { parsed } = first;
  const host = parsed.hostname.replace(/^www\./, "");
  const provider = providerForHost(host);
  const fileName = fileNameOf(parsed);
  const pathKind = provider
    ? kindFromPath(provider, parsed.pathname.toLowerCase())
    : null;
  const fileKind = fileName ? kindFromFileName(fileName) : null;
  // A file name's extension refines a provider's generic "file".
  const kind: LinkKind =
    pathKind && pathKind !== "file" ? pathKind : fileKind ?? pathKind ?? "page";

  return {
    url,
    key: linkKey(parsed),
    host,
    provider,
    kind,
    fileName,
    icon: kind === "page" ? "link" : kind,
  };
}

const ENTER_A_LINK = "Enter a web link, like https://example.com/manual.pdf";
const NO_SPACES = "Enter just the link, with no spaces or other text";
const WEB_ONLY = "Use a web link that starts with https:// or http://";
const TOO_LONG = `Links can be at most ${MAX_LINK_LENGTH} characters long`;

/** A scheme name; one containing a dot is a host followed by a port instead. */
const LEADING_SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function refuse(message: string): LinkInput {
  return { ok: false, message };
}

/**
 * The Link-format input rule, shared by web forms, `buildCustomFieldValue`
 * and the phone input. Trims, adds `https://` to a scheme-less
 * "host.tld/..." value, drops trailing sentence punctuation, and requires
 * http(s), a dotted host, no whitespace and at most `MAX_LINK_LENGTH`
 * characters. Every accepted `url` reads back as a `ParsedLink`.
 */
export function parseLinkInput(input: string): LinkInput {
  const text = input.trim();
  if (text === "") return refuse(ENTER_A_LINK);
  if (/\s/.test(text)) return refuse(NO_SPACES);

  const scheme = LEADING_SCHEME.exec(text)?.[1];
  const hasScheme = scheme !== undefined && !scheme.includes(".");
  if (hasScheme && !/^https?$/i.test(scheme)) return refuse(WEB_ONLY);

  const candidate = hasScheme ? text : `https://${text}`;
  if (!/^https?:\/\/[^/\\]/i.test(candidate)) return refuse(ENTER_A_LINK);

  const url = trimUrlEnd(candidate);
  if (url.length > MAX_LINK_LENGTH) return refuse(TOO_LONG);

  const link = parseLink(url);
  const labels = link?.host.split(".").filter((label) => label !== "") ?? [];
  if (labels.length < 2) return refuse(ENTER_A_LINK);

  return { ok: true, url };
}
