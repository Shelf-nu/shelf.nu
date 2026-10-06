/**
 * Reading SCIM PATCH operations: which attribute one names, and what value it
 * carries.
 *
 * Two rules from RFC 7644 that are easy to get wrong in opposite directions.
 *
 * Attribute names are case-insensitive (§3.10), so a path has to be matched
 * without regard to case. Matching exactly makes a well-formed operation vanish:
 * the IdP is answered 200 and nothing happened, which is indistinguishable from
 * "SCIM does nothing" when someone reports it.
 *
 * A value whose type does not fit the attribute is `invalidValue` (§3.12), so it
 * has to be refused rather than coerced. `String({})` is `"[object Object]"`,
 * which stores cleanly and reads back as a person's name, and the IdP is again
 * told it succeeded. Refusing is the only answer that reaches whoever configured
 * the mapping.
 *
 * @see {@link file://./service.server.ts} `patchScimUser`, the only caller
 * @see {@link file://./errors.server.ts} how a `ScimError` reaches the IdP
 */
import { ScimError } from "./errors.server";

/**
 * The comparable form of a SCIM attribute path.
 *
 * @param path - The operation's `path`, absent on a path-less operation
 * @returns The path lowercased and trimmed, or undefined when there is none
 */
export function normalizeScimPath(
  path: string | undefined
): string | undefined {
  if (typeof path !== "string") {
    return undefined;
  }
  const normalized = path.trim().toLowerCase();
  return normalized === "" ? undefined : normalized;
}

/** Whether a value is a plain object whose keys can be read as attributes. */
export function isScimValueObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Looks up an attribute on a path-less operation's value object, ignoring case.
 *
 * `present` is reported separately from the value, because an attribute that is
 * present and null means "clear this", which is not the same as absent.
 *
 * @param value - The operation's value object
 * @param attribute - The attribute name to find, in any case
 * @returns Whether it was there, and what it held
 */
export function readScimAttribute(
  value: Record<string, unknown>,
  attribute: string
): { present: boolean; value: unknown } {
  const wanted = attribute.toLowerCase();
  // First match wins. A payload carrying the same attribute twice in different
  // cases is malformed, and either answer is as good as the other.
  for (const key of Object.keys(value)) {
    if (key.toLowerCase() === wanted) {
      return { present: true, value: value[key] };
    }
  }
  return { present: false, value: undefined };
}

/**
 * The string a SCIM value carries, for an attribute that stores text.
 *
 * Absent and null both read as empty, which is how an IdP clears an attribute.
 * Anything else is refused: a number, a boolean, an array or an object cannot
 * become a name or an email address, and coercing one produces a value that
 * looks stored and is not what anybody sent.
 *
 * @param value - The raw value from the operation
 * @param attribute - The attribute name, for the error the IdP receives
 * @returns The string to store, empty when the attribute is being cleared
 * @throws {ScimError} 400 `invalidValue` when the value is not text
 */
export function readScimStringValue(value: unknown, attribute: string): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  throw new ScimError(
    `Attribute "${attribute}" must be a string, received ${describeType(
      value
    )}`,
    400,
    "invalidValue"
  );
}

/**
 * Names a rejected value's type for the error detail.
 *
 * The value itself is never echoed: it is attacker-influenced input, and the
 * type is what tells whoever configured the mapping what to change.
 *
 * @param value - The rejected value
 * @returns A word for its type
 */
function describeType(value: unknown): string {
  if (Array.isArray(value)) {
    return "an array";
  }
  if (typeof value === "object") {
    return "an object";
  }
  return `a ${typeof value}`;
}
