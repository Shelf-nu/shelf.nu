/**
 * Finds the web links in text a person typed, so every screen that shows
 * that text can make them tappable.
 *
 * Explicit http(s) URLs come from `segmentText` in `@shelf/links`, the same
 * detector the web app links custom field values with. On top of that, the
 * phone links a bare domain such as `canon.com/r5-specs.pdf` or
 * `www.shelf.nu`, which people type in notes and descriptions far more often
 * than a full URL. The bare-domain rule is conservative on purpose: the last
 * label must be a well-known top-level domain, so file names (`manual.pdf`,
 * `notes.md`), versions (`v1.2`) and abbreviations (`e.g.`) stay text, and an
 * e-mail address is never read as a domain.
 *
 * Pure, and free of React Native, Expo and `@/` imports so the node test
 * runner can load it.
 *
 * @see {@link file://../../../packages/links/src/parse.ts} `segmentText`
 * @see {@link file://../components/links/linked-text.tsx}
 * @see {@link file://./text-links.test.ts}
 */

import { segmentText, type TextSegment } from "@shelf/links";

/**
 * Top-level domains a bare domain may end in, typed in lowercase. Kept to
 * common generic and country domains. Left out, so they still need
 * `https://` to link: ones that double as file extensions (`.ai`, `.app`,
 * `.md`, `.py`, `.sh`, `.rs`, `.pl`, `.zip`, `.mov`) and ones that are
 * English words a missed space after a full stop turns into a domain
 * (`.at`, `.be`, `.in`, `.is`, `.it`, `.me`, `.no`, `.us`).
 */
const BARE_DOMAIN_TLDS = new Set([
  "com",
  "org",
  "net",
  "edu",
  "gov",
  "mil",
  "int",
  "io",
  "co",
  "nu",
  "dev",
  "info",
  "biz",
  "tv",
  "uk",
  "ca",
  "au",
  "nz",
  "ie",
  "de",
  "fr",
  "nl",
  "lu",
  "ch",
  "es",
  "pt",
  "se",
  "dk",
  "fi",
  "eu",
  "bg",
  "ro",
  "cz",
  "sk",
  "hu",
  "gr",
  "jp",
  "kr",
  "sg",
  "hk",
  "za",
  "br",
  "mx",
]);

/**
 * A bare domain candidate: dotted labels, an optional port, then an optional
 * path, query or fragment running to whitespace. Whether the last label is a
 * known top-level domain, what precedes the match, and the trailing
 * punctuation are checked in code (Hermes-safe, no lookbehind).
 */
const BARE_DOMAIN =
  /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24})(?::\d{1,5})?(?:[/?#][^\s<>"]*)?/gi;

/**
 * A match preceded by one of these is part of something else: an e-mail
 * address (`@`), a longer word or URL (`.`, `/`, `-`, `_`, `:`), or a
 * domain someone wrapped in other characters on purpose.
 */
const BLOCKED_BEFORE = /[a-z0-9@._/:\\-]/i;

/**
 * A match followed by one of these is part of a longer word or an e-mail
 * address: "lens.de-fogged", "acme.com@example.org".
 */
const BLOCKED_AFTER = /[a-z0-9@_-]/i;

/**
 * The link `segmentText` reads in `https://<candidate>`: the candidate
 * without its trailing sentence punctuation or unbalanced closing bracket,
 * as a parsed link. Null when nothing linkable is left.
 */
function readBareDomain(
  candidate: string
): { text: string; url: string } | null {
  const [first] = segmentText(`https://${candidate}`);
  if (!first || first.type !== "link") return null;
  const text = first.url.slice("https://".length);
  return text === "" ? null : { text, url: first.url };
}

/** Splits a run with no explicit URL into text and bare-domain link runs. */
function segmentBareDomains(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(BARE_DOMAIN)) {
    const start = match.index;
    const before = start > 0 ? text[start - 1] : "";
    if (before && BLOCKED_BEFORE.test(before)) continue;
    // A capitalised "domain" is a missed space: "damaged.No charger".
    const tld = match[1];
    if (!BARE_DOMAIN_TLDS.has(tld)) continue;
    const rest = text.slice(start + match[0].length);
    if (BLOCKED_AFTER.test(rest.charAt(0))) continue;
    // A hostname that runs on past the TLD ("acme.com.x") is not "acme.com".
    if (/^\.[a-z0-9]/i.test(rest)) continue;

    const link = readBareDomain(match[0]);
    // The TLD must survive trimming: "acme.com." ends at "acme.com".
    if (
      !link ||
      !link.text
        .toLowerCase()
        .split(/[:/?#]/)[0]
        .endsWith(tld)
    ) {
      continue;
    }
    if (start > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, start) });
    }
    segments.push({ type: "link", text: link.text, url: link.url });
    cursor = start + link.text.length;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }
  return segments;
}

/**
 * Splits text into text and link runs. Explicit http(s) URLs link as
 * `segmentText` reads them; in the text between them, a bare domain with a
 * well-known top-level domain links to `https://` plus the domain. A link
 * run's `text` is what the person typed and its `url` what opens.
 *
 * @param text - Text a person typed.
 * @returns The runs in order; concatenating every `text` gives the input.
 */
export function findTextLinks(text: string): readonly TextSegment[] {
  return segmentText(text).flatMap((segment) =>
    segment.type === "text" ? segmentBareDomains(segment.text) : [segment]
  );
}
