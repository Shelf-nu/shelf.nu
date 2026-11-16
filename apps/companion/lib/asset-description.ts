/**
 * Asset description length rule on the phone: the limit, how a description's
 * length is counted, and the message for one that is too long.
 *
 * MIRROR of `ASSET_DESCRIPTION_MAX_LENGTH` in
 * `apps/webapp/app/utils/constants.ts` and of `isAssetDescriptionTooLong` and
 * `ASSET_DESCRIPTION_TOO_LONG_MESSAGE` in
 * `apps/webapp/app/utils/asset-description.ts`, including the line-break rule
 * of `apps/webapp/app/utils/count-characters.ts`. Cosmetic only: the mobile API
 * (`/api/mobile/asset/create` and `/api/mobile/asset/update`) enforces the limit
 * and answers a longer description with HTTP 400 and this same message. The
 * server checks only a description it receives, so a screen that leaves an
 * unchanged description out of its payload must not refuse to save over it.
 * Extraction target: a pure `packages/*` limits module (none yet).
 *
 * This module must stay free of React Native, Expo and `@/` imports: its test
 * runs under Node's test runner.
 *
 * @see ./asset-description.test.ts
 */

/** Max number of characters an asset description can contain. */
export const ASSET_DESCRIPTION_MAX_LENGTH = 5000;

/** The validation message shown when a description is over the limit. */
export const ASSET_DESCRIPTION_TOO_LONG_MESSAGE = `Description must be ${ASSET_DESCRIPTION_MAX_LENGTH.toLocaleString(
  "en-US"
)} characters or fewer`;

/**
 * Counts the characters of user-entered text the way the user sees them.
 * A "\r\n" line break counts as one character, as it does on the web, so the
 * phone's counter and the server's rule agree on text that came from a browser
 * or a CSV import.
 *
 * @param text - The text to count
 * @returns The number of characters, with each line break counted once
 */
export function countCharacters(text: string): number {
  return text.replace(/\r\n/g, "\n").length;
}

/**
 * Whether a description is longer than {@link ASSET_DESCRIPTION_MAX_LENGTH}.
 *
 * @param text - The description text, before any trimming
 * @returns True when the server would refuse the description
 */
export function isAssetDescriptionTooLong(text: string): boolean {
  return countCharacters(text) > ASSET_DESCRIPTION_MAX_LENGTH;
}
