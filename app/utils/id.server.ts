import { init } from "@paralleldrive/cuid2";
import { generateRandomCode } from "~/modules/invite/helpers";
import { FINGERPRINT } from "./env";
import { ShelfError } from "./error";
import { Logger } from "./logger";

export function id(
  /**
   * Default value: 10
   * Default cuid length: 24
   * Min cuid length: 7
   * */
  length?: number
) {
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
