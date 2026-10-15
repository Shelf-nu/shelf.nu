/**
 * Asset description length rule
 *
 * The one place that decides how long an asset description may be and how its
 * length is counted. Every write path (asset form, inline edit, mobile API, CSV
 * create and update imports) and every counter reads from here.
 *
 * Dependency-light (zod only) so both the server and the browser can import it.
 */
import { z } from "zod";
import { ASSET_DESCRIPTION_MAX_LENGTH } from "./constants";
import { countCharacters } from "./count-characters";

/** The limit as the user reads it, for example "5,000". */
export const ASSET_DESCRIPTION_MAX_LENGTH_LABEL =
  ASSET_DESCRIPTION_MAX_LENGTH.toLocaleString("en-US");

/** The validation message shown when a description is over the limit. */
const ASSET_DESCRIPTION_TOO_LONG_MESSAGE = `Description must be ${ASSET_DESCRIPTION_MAX_LENGTH_LABEL} characters or fewer`;

/**
 * Whether a description is longer than {@link ASSET_DESCRIPTION_MAX_LENGTH}.
 * A line break counts as one character (see `countCharacters`).
 *
 * @param text - The description text, before any trimming
 * @returns True when the description cannot be saved
 */
export function isAssetDescriptionTooLong(text: string): boolean {
  return countCharacters(text) > ASSET_DESCRIPTION_MAX_LENGTH;
}

/**
 * Zod rule for a description string. Checks the length before any trim, so a
 * caller that trims does so with `.transform` after this schema.
 */
export const assetDescriptionSchema = z
  .string()
  .refine((value) => !isAssetDescriptionTooLong(value), {
    message: ASSET_DESCRIPTION_TOO_LONG_MESSAGE,
  });
