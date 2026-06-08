import _ from "lodash";

/**
 * .email() has an issue with validating email
 * addresses where the there is a subdomain and a dash included:
 * https://github.com/colinhacks/zod/pull/2157
 * So we use the custom validation
 *  */
export const validEmail = (val: string) =>
  /^([A-Z0-9_+-]+\.?)*[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i.test(val);

export const isLink = (val: string) =>
  /\b(?:https?):\/\/[-\w+&@#/%?=~|$!:,.;]*[\w+&@#/%=~|$]/.test(val);

export const isValidDomain = (val: string) =>
  /^([a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.)+[a-zA-Z]{2,}$/.test(val);

/**
 * Checks that a string is a well-formed `http:`/`https:` URL we can attempt to
 * fetch an image from during CSV import.
 *
 * This deliberately does NOT try to guess whether the URL "looks like" an image
 * from its string (extension / host allow-list / path keywords). Such heuristics
 * reject legitimate dynamic image endpoints — e.g. ASP.NET handlers like
 * `https://host/GetImage.ashx?guid=...` that serve real image bytes but have no
 * extension, no recognizable host, and an opaque path. Whether a URL actually
 * yields an image is decided authoritatively *after* download by
 * `uploadImageFromUrl`, which validates the real `Content-Type` header and the
 * file's magic bytes (`detectImageFormat`).
 *
 * SECURITY: This is a well-formedness pre-filter ONLY — it is NOT an SSRF
 * boundary, and it never was (its old string heuristics were trivially
 * bypassable; see GHSA-xgrm-8w6v-mvjg). The actual SSRF protection
 * (private/reserved IP blocking, redirect revalidation, size cap) lives in
 * `safeFetch` (`~/utils/ssrf.server`), which `uploadImageFromUrl` calls and
 * which independently re-validates the protocol and resolved IP on every
 * redirect hop. Do not rely on this function to gate server-side fetches.
 *
 * @param url - The URL to validate
 * @returns boolean indicating if `url` is a well-formed http(s) URL
 */
export function isValidImageUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

/**
 * Sanitizes a filename, removing invalid characters and replacing spaces with underscores
 * @param filename String to sanitize
 * @returns
 */
export function sanitizeFilename(filename: string): string {
  let s = filename
    .replace(/[/\\:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  if (s.startsWith(".")) {
    s = "_" + s;
  }
  return s;
}

/**
 * Converts the given enum case string to title case
 *
 * @param value - The enum case string to convert
 * @returns The title case string
 * @example SOME_ENUM_CASE -> Some Enum Case
 */
export function formatEnum(value: string) {
  return _.startCase(_.toLower(value));
}
