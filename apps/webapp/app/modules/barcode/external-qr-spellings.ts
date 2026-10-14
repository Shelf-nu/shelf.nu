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

/**
 * The text of a link-like External QR value with its scheme, leading `www.`
 * and one trailing slash removed and its host lower-cased, or `null` when the
 * value is not a link.
 */
export function externalQrCanonical(value: string): string | null {
  if (/\s/.test(value)) return null;
  const hasScheme = SCHEME.test(value);
  const rest = value.replace(SCHEME, "").replace(WWW, "");
  if (!hasScheme && !BARE_HOST.test(rest)) return null;
  const trimmed = rest.endsWith("/") ? rest.slice(0, -1) : rest;
  const hostEnd = trimmed.search(/[/?#]/);
  const host = hostEnd === -1 ? trimmed : trimmed.slice(0, hostEnd);
  const canonical = host.toLowerCase() + trimmed.slice(host.length);
  return canonical || null;
}

/**
 * Every stored spelling that counts as the same External QR as `value`: each
 * scheme, `www.` and trailing-slash form of the link, with the host in lower
 * case and as scanned. A stored host in any other mixed case is not matched.
 */
export function externalQrSpellings(value: string): string[] {
  const canonical = externalQrCanonical(value);
  if (canonical === null) return [value];
  const asScanned = value
    .replace(SCHEME, "")
    .replace(WWW, "")
    .replace(/\/$/, "");
  const spellings = new Set([value]);
  for (const link of [canonical, asScanned]) {
    for (const scheme of ["", "http://", "https://"]) {
      for (const www of ["", "www."]) {
        for (const slash of ["", "/"]) {
          spellings.add(`${scheme}${www}${link}${slash}`);
        }
      }
    }
  }
  return [...spellings];
}
