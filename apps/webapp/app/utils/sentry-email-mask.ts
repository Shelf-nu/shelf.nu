/**
 * Email-address masking for everything sent to Sentry.
 *
 * Sentry events leave the app's own infrastructure, so a user's email address
 * must not be in them. Addresses reach a Sentry payload by several routes:
 * `ShelfError.additionalData` (spread into `extra`), error messages that quote
 * an address, request URLs such as `/otp?email=…`, and the console and
 * navigation breadcrumbs that repeat those URLs. Masking the whole payload in
 * the `beforeSend*` hooks covers all of them without relying on every call site.
 *
 * The local part of an address is replaced and the domain is kept: the domain
 * is what triage needs (which workspace's SSO or mail setup is failing), while
 * the local part is what identifies a person.
 *
 * Safe for the client bundle — no imports, no Node APIs.
 *
 * @see {@link file://./../../server/instrument.server.ts} — server hooks
 * @see {@link file://./../entry.client.tsx} — browser hooks
 */

/** Written in place of the local part of a masked email address. */
export const MASKED_EMAIL_LOCAL_PART = "[email]";

/**
 * An email address, either plain (`jane@acme.com`) or percent-encoded as it
 * appears in a URL (`jane%40acme.com`, `jane%2Btag%40acme.com`).
 *
 * The domain must be dotted and end in letters, so an npm-style specifier in a
 * file path (`@sentry+core@10.51.0`) is never mistaken for an address.
 *
 * Letters and digits are matched in any script, so internationalized addresses
 * (`josé@exämple.de`) are masked. A domain may carry the percent-encoded bytes
 * of non-ASCII letters as a URL writes them (`ex%C3%A4mple.de`) and an encoded
 * dot (`example%2Ecom`), but no other encoded byte: an encoded `@` or comma
 * never lets one address's domain run on into the next address in a list.
 *
 * A quoted local part (`"john doe"@acme.com`) is masked whole, quotes included.
 *
 * The local part accepts every character the email standard allows except the
 * five that delimit a URL (`/ ? = & #`), so an address such as
 * `o'connor@acme.com` or `john!smith@acme.com` is masked whole. Those five stay
 * out because an address in a URL follows them (`/otp?email=jane%40acme.com`),
 * and taking them in would mask the page path along with the address. The same
 * goes for their encoded forms: a percent-encoded byte counts toward the local
 * part only when it encodes a character the local part allows (`%2B` for `+`,
 * the UTF-8 bytes `%80`-`%FF` of a non-ASCII letter), never an encoded `/ ? =
 * & # @`, comma or space. That keeps an encoded path
 * (`%2Fotp%3Femail%3Djane%40acme.com`) and the commas of an encoded list. The
 * trade-off: an address that itself contains one of those characters, or a
 * literal `%`, keeps the part before it unmasked. Such addresses are valid but
 * almost never issued.
 *
 * A percent-encoded byte that does not start an address is matched on its own
 * (the last alternative) and written back unchanged. Consuming it whole is what
 * stops a match starting inside it: without that, `%2Cb%40y.com` would be read
 * from its `2Cb`, since hex digits are letters and digits too. A lookbehind
 * would say the same thing more directly, but it cannot run in the browsers
 * this module ships to.
 *
 * Every repeat is bounded and the local part never runs across an encoded
 * separator, so the time to scan a string grows in line with its length. An
 * unbounded `+` makes each start position rescan the rest of a long run of
 * address characters, which is quadratic on hostile input such as a long
 * token followed by an `@`. The bounds sit above what a real address can
 * reach: 256 characters for a local part (64 in the standard, three times that
 * when percent-encoded), 32 labels of up to 63 characters for a domain.
 */
const EMAIL_ADDRESS =
  /(?:"(?:[^"\\\r\n]|\\[^\r\n]){0,256}"|(?:[\p{L}\p{M}\p{N}.!$'*+^_`{|}~-]|%(?:2[147ABDE]|5[EF]|60|7[B-E]|[89A-F][0-9A-F])){1,256})(@|%40)((?:(?:[\p{L}\p{M}\p{N}-]|%[89A-F][0-9A-F]){1,63}(?:\.|%2E)){1,32}(?:[\p{L}\p{M}]|%[89A-F][0-9A-F]){2,63})|(%[0-9A-F]{2})/giu;

/**
 * Stack traces and debug metadata describe code, not runtime data: file paths,
 * function names and source lines read from disk. They are passed through
 * untouched so masking can never break symbolication. The one exception is a
 * frame's `vars` (captured local variables), which is runtime data and is
 * masked — see {@link maskStacktrace}.
 */
const STACKTRACE_KEY = "stacktrace";
const DEBUG_META_KEY = "debug_meta";

/**
 * Sentry's own bookkeeping on an event: live `Scope` and client objects that
 * Sentry reads before the hooks run and removes before sending. Walking it
 * would copy the whole client on every transaction for nothing, so it is
 * passed through as it is.
 */
const SDK_PROCESSING_METADATA_KEY = "sdkProcessingMetadata";

/**
 * Replaces the local part of every email address in a string, keeping the
 * domain and the separator as written (`@` or `%40`).
 *
 * @param text - Any string bound for Sentry
 * @returns The string with every address masked, or the input when it has none
 */
export function maskEmailAddresses(text: string): string {
  // Most strings in a payload contain neither form of the separator.
  if (!text.includes("@") && !text.includes("%40")) {
    return text;
  }

  return text.replace(
    EMAIL_ADDRESS,
    (_match, separator: string, domain: string, strayEscape?: string) =>
      strayEscape ?? `${MASKED_EMAIL_LOCAL_PART}${separator}${domain}`
  );
}

/**
 * Returns a copy of a Sentry payload (error event, transaction or log) with
 * every email address in every string value masked.
 *
 * Walks nested plain objects and arrays, and copies errors with their message
 * masked. Other class instances (a Date, Map or Set) are passed through as
 * they are, as is Sentry's own processing metadata. Stack traces and debug
 * metadata are kept as they are, apart from captured local variables (see
 * {@link STACKTRACE_KEY}).
 * Shared and cyclic references are copied once, so the copy has the same shape
 * as the input. Never mutates the input.
 *
 * @param payload - The payload a `beforeSend*` hook received
 * @returns A masked copy of the payload
 */
export function maskEmailsInSentryPayload<T>(payload: T): T {
  return maskValue(payload, new WeakMap()) as T;
}

/**
 * Recursive worker for {@link maskEmailsInSentryPayload}.
 *
 * @param value - The value to mask
 * @param copies - Originals already copied, mapped to their copies
 * @returns The masked value
 */
function maskValue(value: unknown, copies: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") {
    return maskEmailAddresses(value);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const existing = copies.get(value);
  if (existing !== undefined) {
    return existing;
  }

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (const item of value) {
      copy.push(maskValue(item, copies));
    }
    return copy;
  }

  if (value instanceof Error) {
    return maskError(value, copies);
  }

  // Only plain objects are rebuilt. A Date, Map, Set or class instance keeps
  // its data in fields a plain copy cannot see, so copying one would turn it
  // into `{}`; such values are passed through as they are.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const copy: Record<string, unknown> = {};
  copies.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    if (key === DEBUG_META_KEY || key === SDK_PROCESSING_METADATA_KEY) {
      copy[key] = item;
    } else if (key === STACKTRACE_KEY) {
      copy[key] = maskStacktrace(item, copies);
    } else {
      copy[key] = maskValue(item, copies);
    }
  }
  return copy;
}

/**
 * Copies an error as the same kind of error, with its message, stack and own
 * fields (such as a `ShelfError`'s `additionalData`) masked.
 *
 * @param error - The error to copy
 * @param copies - Originals already copied, mapped to their copies
 * @returns A masked copy with the original's prototype
 */
function maskError(error: Error, copies: WeakMap<object, unknown>): Error {
  const copy = Object.create(Object.getPrototypeOf(error)) as Error;
  copies.set(error, copy);

  for (const [key, item] of Object.entries(error)) {
    (copy as unknown as Record<string, unknown>)[key] = maskValue(item, copies);
  }
  copy.message = maskEmailAddresses(error.message);
  if (error.stack !== undefined) {
    copy.stack = maskEmailAddresses(error.stack);
  }
  if (error.cause !== undefined) {
    copy.cause = maskValue(error.cause, copies);
  }

  return copy;
}

/**
 * Copies a Sentry stack trace, masking only each frame's captured local
 * variables (`vars`). Everything else in a frame is a code location and is
 * kept as it is.
 *
 * @param stacktrace - The `stacktrace` value of an exception or thread
 * @param copies - Originals already copied, mapped to their copies
 * @returns The stack trace with frame variables masked
 */
function maskStacktrace(
  stacktrace: unknown,
  copies: WeakMap<object, unknown>
): unknown {
  if (
    !stacktrace ||
    typeof stacktrace !== "object" ||
    !("frames" in stacktrace) ||
    !Array.isArray(stacktrace.frames)
  ) {
    return stacktrace;
  }

  return {
    ...stacktrace,
    frames: stacktrace.frames.map((frame: unknown) =>
      frame && typeof frame === "object" && "vars" in frame
        ? { ...frame, vars: maskValue(frame.vars, copies) }
        : frame
    ),
  };
}
