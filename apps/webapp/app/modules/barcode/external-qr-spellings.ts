/**
 * External QR codes are stored as the raw text they encode, but one link can
 * be written several ways. A workspace that imported `example.it/ABC123`
 * prints stickers encoding `https://example.it/ABC123`, and both must scan to
 * the same item. These helpers define which spellings count as one code: the
 * same text up to an `http://` / `https://` scheme, a leading `www.`, one
 * trailing slash and the case of the host name. Text that does not look like a
 * link is left alone, and the path always keeps its case.
 */

const SCHEME = /^https?:\/\//i;
const WWW = /^www\./i;
/** A host with at least one dot and a letter-led top-level label, then a path. */
const BARE_HOST =
  /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]*(:\d+)?([/?#]|$)/i;

/** A link split into its host and the rest, with an optional slash dropped. */
interface ParsedLink {
  host: string;
  /** Path, query and fragment, without a trailing path slash. */
  tail: string;
  /** False when the link has a query or fragment, whose last `/` is data. */
  slashIsOptional: boolean;
}

function parseLink(value: string): ParsedLink | null {
  if (/\s/.test(value)) return null;
  const hasScheme = SCHEME.test(value);
  const rest = value.replace(SCHEME, "").replace(WWW, "");
  if (!hasScheme && !BARE_HOST.test(rest)) return null;
  const hostEnd = rest.search(/[/?#]/);
  const host = hostEnd === -1 ? rest : rest.slice(0, hostEnd);
  if (!host) return null;
  const tail = rest.slice(host.length);
  const slashIsOptional = !/[?#]/.test(tail);
  return {
    host,
    tail: slashIsOptional && tail.endsWith("/") ? tail.slice(0, -1) : tail,
    slashIsOptional,
  };
}

/**
 * The text of a link-like External QR value with its scheme, leading `www.`
 * and trailing path slash removed and its host lower-cased, or `null` when
 * the value is not a link. A slash at the end of a query or fragment is kept.
 */
export function externalQrCanonical(value: string): string | null {
  const link = parseLink(value);
  return link ? link.host.toLowerCase() + link.tail : null;
}

/**
 * Every stored spelling that counts as the same External QR as `value`: each
 * scheme, `www.` and trailing-slash form of the link, with the host in lower
 * case, in upper case (with an upper-case scheme and `www.` too, as QR
 * encoders that upper-case a whole link write it) and as scanned. A stored
 * host in any other mixed case is not matched.
 */
export function externalQrSpellings(value: string): string[] {
  const link = parseLink(value);
  if (link === null) return [value];
  const lowerPrefixes = {
    schemes: ["", "http://", "https://"],
    www: ["", "www."],
  };
  const upperPrefixes = {
    schemes: ["", "HTTP://", "HTTPS://"],
    www: ["", "WWW."],
  };
  const forms = [
    { host: link.host.toLowerCase(), prefixes: [lowerPrefixes] },
    { host: link.host, prefixes: [lowerPrefixes] },
    { host: link.host.toUpperCase(), prefixes: [lowerPrefixes, upperPrefixes] },
  ];
  const slashes = link.slashIsOptional ? ["", "/"] : [""];
  const spellings = new Set([value]);
  for (const { host, prefixes } of forms) {
    for (const { schemes, www } of prefixes) {
      for (const scheme of schemes) {
        for (const w of www) {
          for (const slash of slashes) {
            spellings.add(`${scheme}${w}${host}${link.tail}${slash}`);
          }
        }
      }
    }
  }
  return [...spellings];
}
