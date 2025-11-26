import { init } from "@paralleldrive/cuid2";
import { hasNumber } from ".";
import { DEFAULT_CUID_LENGTH } from "../constants";
import { FINGERPRINT } from "../env";
import { ShelfError } from "../error";
import { Logger } from "../logger";

/**
 * Generate a unique id using cuid2
 * @param length - The length of the id. Default is 10. Min is 7. Max is 24.
 * @returns A unique id
 * */
export function id(length?: number) {
  try {
    if (length && length < 7) {
      Logger.error(
        new ShelfError({
          cause: null,
          message: "Id is too short",
          additionalData: { length },
          label: "DB",
        })
      );
    }
    let generatedId = init({
      length: length || DEFAULT_CUID_LENGTH,
      /** FINGERPRINT is not required but it helps with avoiding collision */
      ...(FINGERPRINT && { fingerprint: FINGERPRINT }),
    })();

    /**
     * Because of the custom length we are passing,
     * there are situations where the generated id does not have a number,
     * which is a requirement for a QR id.
     * In that case we generate a random number between 0 and 9 and replace the charactear at its own index.
     * We have to make sure we never replace the first character because it must be a letter.
     * */

    if (!hasNumber(generatedId)) {
      const randomNumber = Math.floor(Math.random() * 10);
      /**
       * 1. Math.random() generates a random floating-point number between 0 (inclusive) and 1 (exclusive).
       * 2. Multiplying by 9 scales this to a range of 0 (inclusive) to 9 (exclusive).
       * 3. Math.floor() rounds down to the nearest whole number, resulting in an integer between 0 and 8 (inclusive).
       * 4. Adding 1 shifts the range to between 1 and 9 (inclusive).
       */
      const randomIndex = Math.floor(Math.random() * 9) + 1;

      // Convert generatedId to an array of characters
      const generatedIdArray = generatedId.split("");
      // Replace the character at randomIndex with randomNumber
      generatedIdArray[randomIndex] = randomNumber.toString();

      // Join the array back into a string
      generatedId = generatedIdArray.join("");
    }
    return generatedId;
  } catch (cause) {
    const e = new ShelfError({
      cause,
      message: "Id generation failed",
      label: "DB",
    });
    Logger.error(e);
    throw e;
  }
}
