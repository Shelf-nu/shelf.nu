/**
 * Sanitizes a filename to prevent issues with content-disposition headers
 * and ensure compatibility with multipart form data parsing.
 *
 * This function addresses the specific issue where filenames containing:
 * - Base64 characters (=, +, /)
 * - Special characters that can break RFC-compliant parsing
 * - Unescaped quotes or problematic characters
 *
 * Example problematic filename:
 * "L2ltYWdlcy9wcm9kdWN0L21haW4vUy0wMTk1NDRfMDEuanBlZw==_H_SH480_MW480.png"
 *
 * @param filename - The original filename from the file input
 * @returns A sanitized filename safe for content-disposition headers
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) {
    return "file";
  }

  // Extract the file extension first
  const lastDotIndex = filename.lastIndexOf(".");
  const rawExtension =
    lastDotIndex > -1 ? filename.slice(lastDotIndex + 1) : "";
  const nameWithoutExtension =
    lastDotIndex > -1 ? filename.slice(0, lastDotIndex) : filename;

  // Sanitize the extension by keeping only alphanumeric characters
  const sanitizedExtension = rawExtension.replace(/[^a-zA-Z0-9]/g, "");
  const extension =
    sanitizedExtension.length > 0 ? `.${sanitizedExtension}` : "";

  // Sanitize the filename (without extension)
  const sanitized = nameWithoutExtension
    // Replace base64 padding and URL-unsafe characters
    .replace(/[=+/]/g, "-")
    // Replace any remaining special characters that could break parsing
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    // Remove multiple consecutive separators
    .replace(/[-_]{2,}/g, "_")
    // Ensure it doesn't start or end with special characters
    .replace(/^[-._]+|[-._]+$/g, "")
    // Limit length to prevent extremely long filenames
    .substring(0, 100);

  // Fallback if the name becomes empty after sanitization
  const finalName = sanitized || "file";

  return finalName + extension;
}

/**
 * Sanitizes a File object by creating a new File with a clean filename
 * while preserving all other properties (content, type, etc.)
 *
 * @param file - The original File object
 * @returns A new File object with sanitized filename
 */
export function sanitizeFile(file: File): File {
  const sanitizedName = sanitizeFilename(file.name);

  // Only create a new File if the name actually changed
  if (sanitizedName === file.name) {
    return file;
  }

  return new File([file], sanitizedName, {
    type: file.type,
    lastModified: file.lastModified,
  });
}
