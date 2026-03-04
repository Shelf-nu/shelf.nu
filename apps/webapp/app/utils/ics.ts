/** Escapes text for ICS property values per RFC 5545 §3.3.11 */
export function escapeICalText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Folds a content line to 75 **octets** per RFC 5545 §3.1.
 * Continuation lines start with a single SPACE (which itself counts as
 * 1 octet of the next 75-octet chunk).
 *
 * Uses TextEncoder to measure UTF-8 byte length so multi-byte characters
 * (Thai, Chinese, emoji) are handled correctly and never split mid-sequence.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let offset = 0;
  let isFirst = true;

  while (offset < bytes.length) {
    // First line: 75 octets; continuation lines: 74 octets + 1 SPACE prefix
    const chunkSize = isFirst ? 75 : 74;
    let end = Math.min(offset + chunkSize, bytes.length);

    // Don't split in the middle of a multi-byte UTF-8 sequence.
    // UTF-8 continuation bytes have the pattern 10xxxxxx (0x80..0xBF).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    const chunk = new TextDecoder().decode(bytes.slice(offset, end));
    parts.push(isFirst ? chunk : " " + chunk);
    offset = end;
    isFirst = false;
  }

  return parts.join("\r\n");
}
