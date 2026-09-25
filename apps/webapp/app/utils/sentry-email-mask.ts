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
 */
const EMAIL_ADDRESS = /[A-Z0-9._%+-]+(@|%40)((?:[A-Z0-9-]+\.)+[A-Z]{2,})/gi;

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

  return text.replace(EMAIL_ADDRESS, `${MASKED_EMAIL_LOCAL_PART}$1$2`);
}

/**
 * Returns a copy of a Sentry payload (error event, transaction or log) with
 * every email address in every string value masked.
 *
 * Walks nested objects and arrays. Stack traces and debug metadata are kept as
 * they are, apart from captured local variables (see {@link STACKTRACE_KEY}).
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

  const copy: Record<string, unknown> = {};
  copies.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    if (key === DEBUG_META_KEY) {
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
