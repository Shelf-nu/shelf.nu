/**
 * Recipient List Parsing
 *
 * Turns a `to` value (one address or a comma separated list) into the
 * mailboxes it holds, and back into a header. Shared by the email worker
 * (which checks each mailbox against the soft-deleted domain) and the
 * feedback email (which reads its recipients from FEEDBACK_EMAIL), so both
 * read a list the same way.
 *
 * Parsing goes through nodemailer's own address parser rather than a split
 * on ",": a quoted display name may contain a comma (`"Doe, Jane" <j@x>`),
 * and the soft-deleted check must see the bare address, not `Name <x@y>`.
 *
 * @see {@link file://./email.worker.server.ts}
 * @see {@link file://./feedback/feedback-email.tsx}
 */
import addressparser from "nodemailer/lib/addressparser";

/** One mailbox from a `to` header */
export type Recipient = { name: string; address: string };

/**
 * Parses a `to` value into its mailboxes.
 *
 * Entries without an address are dropped, and repeats are removed
 * case-insensitively by address (the first spelling wins) because nodemailer
 * delivers the same message twice when an address appears twice.
 *
 * @param value - A single address or a comma separated list; may be empty
 * @returns The distinct mailboxes, in their original order
 */
export function parseRecipientList(value: string | undefined): Recipient[] {
  const seen = new Set<string>();

  return addressparser(value ?? "", { flatten: true })
    .map(({ name, address }) => ({
      name: name.trim(),
      address: address.trim(),
    }))
    .filter(({ address }) => {
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

/**
 * Formats mailboxes back into a `to` header. Display names are quoted, with
 * any `"` or `\` escaped, so a name containing a comma stays one mailbox.
 *
 * @param recipients - Mailboxes from {@link parseRecipientList}
 * @returns A comma separated header value, or "" for an empty list
 */
export function formatRecipientList(recipients: Recipient[]): string {
  return recipients
    .map(({ name, address }) =>
      name ? `"${name.replace(/["\\]/g, "\\$&")}" <${address}>` : address
    )
    .join(", ");
}
