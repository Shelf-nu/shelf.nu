/**
 * Link preview policy
 *
 * Pure rules for reading a page title from the start of a fetched page, and
 * for when a link may be fetched again. The fetch itself lives in
 * `fetch-title.server.ts`; this file only judges what came back, so every
 * rule can be tested on fixtures without a network.
 *
 * A title is og:title, else twitter:title, else `<title>`, decoded and
 * cleaned by `cleanLinkTitle` from `@shelf/links`. Pages that sit behind a
 * sign-in or a bot challenge never yield a title: the chip falls back to what
 * the URL alone says. A title is read again after a while, so a renamed
 * document or a misread page heals on its own.
 *
 * @see {@link file://./fetch-title.server.ts} the fetch that feeds `classifyHead`
 * @see {@link file://./service.server.ts} where outcomes are stored
 */

import { cleanLinkTitle } from "@shelf/links";
import type { ParsedLink } from "@shelf/links";

/**
 * What one fetch of a link's page found. The outcomes match the
 * `LinkPreviewOutcome` enum; `permanent` says whether trying again later is
 * pointless.
 */
export type PageTitleResult =
  | { readonly outcome: "TITLE"; readonly title: string }
  | { readonly outcome: "NO_TITLE" | "SIGN_IN" }
  | {
      readonly outcome: "BLOCKED" | "UNREACHABLE";
      readonly permanent: boolean;
    };

/** The start of a fetched page, as `safeFetchPrefix` returns it. */
export interface FetchedHead {
  readonly link: ParsedLink;
  readonly status: number;
  /** Where the response came from, after redirects. */
  readonly finalUrl: URL;
  readonly headers: Headers;
  /** The body bytes read; empty when the body was not read. */
  readonly body: Uint8Array;
}

const SIGN_IN: PageTitleResult = { outcome: "SIGN_IN" };
const NO_TITLE: PageTitleResult = { outcome: "NO_TITLE" };
const BLOCKED: PageTitleResult = { outcome: "BLOCKED", permanent: false };
const UNREACHABLE_FOR_NOW: PageTitleResult = {
  outcome: "UNREACHABLE",
  permanent: false,
};
const UNREACHABLE_FOR_GOOD: PageTitleResult = {
  outcome: "UNREACHABLE",
  permanent: true,
};

/** Media types worth reading for a title. */
const HTML_MEDIA_TYPES: readonly string[] = [
  "text/html",
  "application/xhtml+xml",
];

/**
 * Pages a private link redirects to when the reader is not signed in. A
 * `path` limits the match to that path and below.
 */
const SIGN_IN_PAGES: readonly { host: string; path?: string }[] = [
  { host: "login.microsoftonline.com" },
  { host: "login.live.com" },
  { host: "login.windows.net" },
  { host: "accounts.google.com" },
  { host: "www.dropbox.com", path: "/login" },
  { host: "account.box.com", path: "/login" },
  { host: "app.box.com", path: "/login" },
];

/**
 * Text a Cloudflare challenge interstitial carries. Cloudflare also adds its
 * challenge-platform script to ordinary pages, so a marker only counts on a
 * status the interstitial is served with.
 */
const CHALLENGE_MARKERS: readonly string[] = [
  "challenge-platform",
  "cf-browser-verification",
];

/** Statuses a Cloudflare challenge interstitial is served with. */
const CHALLENGE_STATUSES: readonly number[] = [403, 429, 503];

/** The title of a Cloudflare challenge interstitial. */
const CHALLENGE_TITLE = /^just a moment(?:\.\.\.|\u2026)?$/i;

/** Words that make a page title the title of a sign-in or refusal page. */
const SIGN_IN_WORDS =
  "(?:sign[ -]?in|log[ -]?in|sign[ -]?on|single sign[ -]?on|access denied)";

/**
 * A sign-in page's title: one of {@link SIGN_IN_WORDS} alone, followed by
 * "to ..." ("Sign in to your account") or by a separator ("Login | Example
 * Corp"), or after a separator at its end ("Example Corp - Sign In"). A
 * document that only starts with the words ("Sign-in sheet", "Login
 * instructions") keeps its title.
 */
const SIGN_IN_TITLE = new RegExp(
  String.raw`^${SIGN_IN_WORDS}(?:\s+to\b.*|\s*[-|:\u00b7\u2013\u2014].*)?$|[-|:\u00b7\u2013\u2014]\s*${SIGN_IN_WORDS}$`,
  "i"
);

/**
 * How long after the 1st, 2nd and 3rd transient failure in a row a link is
 * eligible for a fetch again.
 */
const RETRY_DELAYS_MS: readonly number[] = [
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
];

/** How long after a fetch that found a title the link is eligible again. */
const TITLE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether a response with this `content-type` may hold an HTML page. An
 * absent header counts as yes, since the body can still be read for a title.
 *
 * @param contentType - The raw `content-type` header, or null
 */
export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  return HTML_MEDIA_TYPES.includes(mediaTypeOf(contentType));
}

/**
 * Judges the start of a fetched page.
 *
 * In order: a sign-in page as the final URL is SIGN_IN; a bot challenge is
 * BLOCKED (`cf-mitigated: challenge`, challenge markers on a 403, 429 or 503,
 * or a "Just a moment..." title); then the status decides (401 is SIGN_IN,
 * 403 is SIGN_IN on a file-sharing service and BLOCKED elsewhere, 429 is
 * BLOCKED, 408 and 5xx are worth retrying, any other non-2xx is not); a
 * non-HTML 2xx is NO_TITLE; otherwise the page's title decides between TITLE,
 * SIGN_IN (a title such as "Sign in" or "Example Corp - Login") and NO_TITLE.
 *
 * @param head - The fetched status, final URL, headers and body prefix
 * @returns The outcome to store for the link
 */
export function classifyHead(head: FetchedHead): PageTitleResult {
  if (isSignInPage(head.finalUrl)) return SIGN_IN;

  const contentType = head.headers.get("content-type");
  const html = isHtmlContentType(contentType)
    ? decodeHtml(head.body, contentType)
    : null;
  const page = html === null ? null : pageHead(html);
  if (isChallenge(head.status, head.headers, page)) return BLOCKED;

  const byStatus = outcomeForStatus(head.status, head.link);
  if (byStatus) return byStatus;
  if (page === null) return NO_TITLE;

  const title = readTitle(page, head.link);
  if (!title) return NO_TITLE;
  return SIGN_IN_TITLE.test(title) ? SIGN_IN : { outcome: "TITLE", title };
}

/**
 * When a link becomes eligible for a fetch again after this result. Nothing
 * fetches it at that time: an eligible link is fetched again only when
 * someone views it.
 *
 * A title is eligible again after 30 days. A transient failure is eligible
 * again 1 hour, 1 day and 7 days later, then never. NO_TITLE, SIGN_IN and
 * permanent failures are final (null).
 *
 * @param result - What the fetch found
 * @param attempts - Failed fetches in a row since the link last had a title,
 *   this one included
 * @param now - When the fetch finished
 * @returns The earliest time of the next fetch, or null for never
 */
export function nextFetchAfter(
  result: PageTitleResult,
  attempts: number,
  now: Date
): Date | null {
  const transient = "permanent" in result && !result.permanent;
  const delay =
    result.outcome === "TITLE"
      ? TITLE_REFRESH_MS
      : transient
      ? RETRY_DELAYS_MS[attempts - 1]
      : undefined;
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

/** Named character references a page title commonly uses. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

const CHARACTER_REFERENCE =
  /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([a-zA-Z]+));/g;

/**
 * Decodes HTML character references in one pass: every numeric reference
 * (`&#233;`, `&#xE9;`; an invalid code point becomes U+FFFD) and the named
 * references in {@link NAMED_ENTITIES}. Unknown names stay as written.
 *
 * @param text - Text from an HTML attribute or element
 * @returns The text with its references replaced
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    CHARACTER_REFERENCE,
    (reference, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) return NAMED_ENTITIES[name] ?? reference;
      const codePoint = decimal
        ? Number.parseInt(decimal, 10)
        : Number.parseInt(hex ?? "", 16);
      const valid =
        codePoint > 0 &&
        codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff);
      return valid ? String.fromCodePoint(codePoint) : "�";
    }
  );
}

/** `text/html; charset=utf-8` becomes `text/html`. */
function mediaTypeOf(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

function isSignInPage(url: URL): boolean {
  return SIGN_IN_PAGES.some(
    ({ host, path }) =>
      url.hostname === host &&
      (!path || url.pathname === path || url.pathname.startsWith(`${path}/`))
  );
}

/**
 * Whether the response is a bot challenge rather than the page. A page that
 * merely carries Cloudflare's script is not one.
 */
function isChallenge(
  status: number,
  headers: Headers,
  page: PageHead | null
): boolean {
  if (headers.get("cf-mitigated")?.toLowerCase() === "challenge") return true;
  if (page === null) return false;
  if (
    CHALLENGE_STATUSES.includes(status) &&
    CHALLENGE_MARKERS.some((marker) => page.lowerHtml.includes(marker))
  ) {
    return true;
  }
  const title = titleText(page);
  return (
    title !== undefined &&
    CHALLENGE_TITLE.test(decodeHtmlEntities(title).trim())
  );
}

/** The outcome a non-2xx status settles on its own; null for 2xx. */
function outcomeForStatus(
  status: number,
  link: ParsedLink
): PageTitleResult | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return SIGN_IN;
  // A file-sharing service answers 403 to a link only signed-in people may
  // open; elsewhere 403 is a site refusing bots.
  if (status === 403) return link.provider ? SIGN_IN : BLOCKED;
  if (status === 429) return BLOCKED;
  if (status === 408 || status >= 500) return UNREACHABLE_FOR_NOW;
  return UNREACHABLE_FOR_GOOD;
}

const CHARSET_PARAMETER = /charset\s*=\s*["']?([\w.:-]+)/i;
const META_CHARSET = /<meta\b[^>]*?charset\s*=\s*["']?([\w.:-]+)/i;

/** Browsers look for a `<meta charset>` only in the first 1024 bytes. */
const CHARSET_PRESCAN_BYTES = 1024;

/**
 * Decodes the body with the charset from the `content-type` header, else a
 * `<meta charset>` (or `http-equiv` content type) in the first 1024 bytes,
 * else UTF-8. A label `TextDecoder` does not know falls back to UTF-8.
 */
function decodeHtml(body: Uint8Array, contentType: string | null): string {
  const prescan = body.subarray(0, CHARSET_PRESCAN_BYTES);
  const label =
    contentType?.match(CHARSET_PARAMETER)?.[1] ??
    // Charset names are ASCII, so a single-byte read finds them in any
    // ASCII-compatible encoding.
    new TextDecoder("windows-1252").decode(prescan).match(META_CHARSET)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/**
 * One attribute: a name and an optional value. The value is optional so a
 * match never fails after its name, which keeps the scan linear on any input.
 */
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Lowercases A-Z only, so every index still lines up with the original. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/** A decoded page, and its head: the text before `</head`, if any. */
interface PageHead {
  /** The whole decoded page with A-Z lowercased. */
  readonly lowerHtml: string;
  readonly head: string;
  /** `head` with A-Z lowercased, so every index lines up with it. */
  readonly lower: string;
}

function pageHead(html: string): PageHead {
  const lowerHtml = asciiLower(html);
  const headEnd = lowerHtml.indexOf("</head");
  return headEnd === -1
    ? { lowerHtml, head: html, lower: lowerHtml }
    : {
        lowerHtml,
        head: html.slice(0, headEnd),
        lower: lowerHtml.slice(0, headEnd),
      };
}

/**
 * og:title, else twitter:title, else `<title>`, from the page head. The first
 * candidate that is still a title after decoding and cleaning wins.
 *
 * The page is untrusted and up to 1 MB, and this runs in the web server's
 * process, so tags are found with index scans rather than regular
 * expressions that rescan from every unclosed `<meta` or `<title`: the work
 * stays linear in the page's length.
 */
function readTitle(page: PageHead, link: ParsedLink): string | null {
  const { head, lower } = page;

  const metaContent = new Map<string, string>();
  for (const tag of metaTags(head, lower)) {
    const attributes = new Map<string, string>();
    for (const [, name, double, single, bare] of tag.matchAll(ATTRIBUTE)) {
      const value = double ?? single ?? bare;
      if (value !== undefined) attributes.set(asciiLower(name), value);
    }
    const key = attributes.get("property") ?? attributes.get("name");
    const content = attributes.get("content");
    if (key && content !== undefined && !metaContent.has(asciiLower(key))) {
      metaContent.set(asciiLower(key), content);
    }
  }

  const candidates = [
    metaContent.get("og:title"),
    metaContent.get("twitter:title"),
    titleText(page),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const title = cleanLinkTitle(decodeHtmlEntities(candidate), link);
    if (title) return title;
  }
  return null;
}

/**
 * The attribute text of each complete `<meta ...>` tag in `head`, without the
 * leading `<meta`. `lower` is `head` with A-Z lowercased.
 */
function metaTags(head: string, lower: string): string[] {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const open = lower.indexOf("<meta", from);
    if (open === -1) return tags;
    const close = lower.indexOf(">", open);
    if (close === -1) return tags;
    if (/[\s/>]/.test(lower[open + 5])) {
      tags.push(head.slice(open + 5, close));
    }
    from = close + 1;
  }
}

/** The text of the first complete `<title>` element in the head, if any. */
function titleText({ head, lower }: PageHead): string | undefined {
  const open = lower.indexOf("<title");
  if (open === -1) return undefined;
  const contentStart = lower.indexOf(">", open) + 1;
  if (contentStart === 0) return undefined;
  const close = lower.indexOf("</title", contentStart);
  return close === -1 ? undefined : head.slice(contentStart, close);
}
