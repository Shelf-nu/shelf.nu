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
 * Validates if a string is a properly formatted URL and potentially an image URL
 * @param url - The URL to validate
 * @returns boolean indicating if URL is valid
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
    return imageExtensions.some((ext) =>
      parsedUrl.pathname.toLowerCase().endsWith(ext)
    );
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

export async function getImageAsBase64(url: string) {
  try {
    // Fetch the image data
    const response = await fetch(url);

    const arrayBuffer = await response.arrayBuffer();

    // Convert the image data to a Base64-encoded string
    const base64Image = Buffer.from(arrayBuffer).toString("base64");

    return base64Image;

    // Convert the image data to a Base64-encoded string
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Error fetching image:", error);
    return null;
  }
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
