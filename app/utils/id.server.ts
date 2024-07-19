import { init } from "@paralleldrive/cuid2";
import { generateRandomCode } from "~/modules/invite/helpers";
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
      length: length || 10,
      fingerprint: FINGERPRINT || generateRandomCode(10),
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
