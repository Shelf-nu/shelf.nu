import { init } from "@paralleldrive/cuid2";
import { DEFAULT_CUID_LENGTH } from "./constants";
import { FINGERPRINT } from "./env";
import { ShelfError } from "./error";
import { Logger } from "./logger";

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
    return init({
      length: length || DEFAULT_CUID_LENGTH,
      /** FINGERPRINT is not required but it helps with avoiding collision */
      ...(FINGERPRINT && { fingerprint: FINGERPRINT }),
    })();
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause: null,
        message: "Id generation failed",
        label: "DB",
      })
    );
  }
}
