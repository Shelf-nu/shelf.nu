/**
 * Tests for the answer a scanner route gives when its save fails.
 *
 * @see {@link file://./scan-save-error.server.ts}
 */
import { describe, expect, it } from "vitest";
import { ShelfError } from "./error";
import { scanSaveError } from "./scan-save-error.server";
import { getScanSubmitFailure } from "./scan-submit-failure";

function failWith(status: 400 | 404 | 500 | 503) {
  return new ShelfError({
    cause: null,
    message: "The save failed",
    label: "Booking",
    status,
  });
}

describe("scanSaveError", () => {
  it.each([400, 404] as const)(
    "answers a %i refusal as a plain refusal",
    (status) => {
      const answer = scanSaveError(failWith(status));

      expect(answer.init?.status).toBe(status);
      expect(answer.data.error.message).toBe("The save failed");
      expect(getScanSubmitFailure(answer.data)).toBeNull();
    }
  );

  it.each([500, 503] as const)(
    "marks a %i the app answers as a save that could not be confirmed",
    (status) => {
      const answer = scanSaveError(failWith(status));

      expect(answer.init?.status).toBe(status);
      expect(answer.data.error.message).toBe("The save failed");
      expect(getScanSubmitFailure(answer.data)).toEqual({
        kind: "server",
        status,
      });
    }
  );
});
