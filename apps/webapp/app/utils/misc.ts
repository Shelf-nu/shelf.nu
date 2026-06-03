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
 * Heuristic check that a string looks like an image URL (correct protocol,
 * plausible extension / image-service host / image-ish path).
 *
 * SECURITY: This is a UX pre-filter ONLY — it is NOT an SSRF boundary. The
 * checks below match on the URL *string*, which the user controls and which a
 * redirect can change after the fact, so they cannot decide whether a
 * destination is safe to reach. The actual SSRF protection (private/reserved
 * IP blocking, redirect revalidation, size cap) lives in `safeFetch`
 * (`~/utils/ssrf.server`), which is what `uploadImageFromUrl` calls. Do not
 * rely on this function to gate server-side fetches. See GHSA-xgrm-8w6v-mvjg.
 *
 * @param url - The URL to validate
 * @returns boolean indicating if URL plausibly points at an image
 */
export function isValidImageUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    // Check if URL has a valid protocol
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return false;
    }

    // Check if URL ends with common image extensions
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const hasImageExtension = imageExtensions.some((ext) =>
      parsedUrl.pathname.toLowerCase().endsWith(ext)
    );

    // If it has a clear image extension, it's valid
    if (hasImageExtension) {
      return true;
    }

    // Allow URLs from known image services that use dynamic URLs
    const imageServiceDomains = [
      "lnk.sortly.co",
      "cloudinary.com",
      "amazonaws.com",
      "googleusercontent.com",
      "imgur.com",
      "unsplash.com",
      "pexels.com",
    ];

    // Check if the hostname contains any known image service domains
    const isImageService = imageServiceDomains.some((domain) =>
      parsedUrl.hostname.includes(domain)
    );

    // Also check for common image-related path patterns
    const hasImagePath =
      /\/(photo|image|img|pic|picture|download|media|asset)/i.test(
        parsedUrl.pathname
      );

    return isImageService || hasImagePath;
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
