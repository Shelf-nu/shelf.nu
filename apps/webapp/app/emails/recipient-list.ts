/**
 * Recipient List Parsing
 *
 * Turns a comma separated `to` value into the individual addresses it holds.
 * Shared by the email worker (which checks each address against the
 * soft-deleted domain) and the feedback email (which reads its recipients
 * from FEEDBACK_EMAIL), so both read a list the same way.
 *
 * @see {@link file://./email.worker.server.ts}
 * @see {@link file://./feedback/feedback-email.tsx}
 */

/**
 * Splits a comma separated list of email addresses into its entries.
 *
 * Entries are trimmed, empty entries are dropped, and repeats are removed
 * case-insensitively (the first spelling wins) because nodemailer delivers
 * the same message twice when an address appears twice.
 *
 * @param value - A single address or a comma separated list; may be empty
 * @returns The distinct, trimmed addresses, in their original order
 */
export function parseRecipientList(value: string | undefined): string[] {
  const seen = new Set<string>();

  return (value ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => {
      if (!address) {
        return false;
      }
      const key = address.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}
