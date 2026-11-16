/**
 * Validates companion-app version strings an operator sets in the environment.
 *
 * `/api/mobile/config` serves `MIN_COMPANION_VERSION` and
 * `LATEST_COMPANION_VERSION` to the companion app, which ignores any value it
 * cannot parse: an unreadable minimum gates nothing and an unreadable latest
 * shows no banner. Both fail silently on the phone, so the server checks the
 * format and warns where an operator will see it.
 *
 * The accepted shape mirrors `parseVersionSegments` in
 * `apps/companion/lib/server/contract.ts`: dot-separated numbers, optionally
 * followed by a `-pre-release` or `+build` suffix. Change one, change both.
 *
 * @see {@link file://./../routes/api+/mobile+/config.ts}
 */

const COMPANION_VERSION_PATTERN = /^\d+(\.\d+)*([-+].*)?$/;

/**
 * Reads a companion version from an env value.
 *
 * @param value - The raw env value; empty or undefined when unset.
 * @returns The trimmed version, or `null` when unset. `invalid` is `true` when
 *   a value was set but the app could not read it, so the caller can warn.
 */
export function readCompanionVersion(value: string | undefined): {
  version: string | null;
  invalid: boolean;
} {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { version: null, invalid: false };
  if (!COMPANION_VERSION_PATTERN.test(trimmed)) {
    return { version: null, invalid: true };
  }
  return { version: trimmed, invalid: false };
}
