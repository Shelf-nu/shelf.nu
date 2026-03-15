import {
  ShelfError,
  isLikeShelfError,
  isTransientError,
  makeShelfError,
} from "./error";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

describe(makeShelfError.name, () => {
  describe("cause is like a ShelfError", () => {
    it("should return the cause", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        message: "I am an error",
      });

      expect(makeShelfError(cause)).toEqual(cause);
    });

    it("should merge additionalData", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        message: "I am an error",
        additionalData: { assetId: "asset-id" },
      });

      const error = makeShelfError(cause, {
        userId: "user-id",
      });

      expect(error.additionalData).toEqual({
        ...error.additionalData,
        ...cause.additionalData,
      });
    });
  });
  describe("cause is a transient database error", () => {
    it("should return a 503 DB error for a direct connection failure", () => {
      const cause = Object.assign(new Error("Connection failure"), {
        code: "08006",
      });

      const error = makeShelfError(cause);

      expect(error.status).toEqual(503);
      expect(error.label).toEqual("DB");
      expect(error.message).toContain("temporary database connectivity");
    });

    it("should return a 503 DB error when connection error is wrapped in a ShelfError", () => {
      const dbError = Object.assign(new Error("Connection failure"), {
        code: "08006",
      });
      const wrappedCause = new ShelfError({
        cause: dbError,
        label: "User",
        message: "The user you are trying to access does not exist",
        status: 404,
      });

      const error = makeShelfError(wrappedCause);

      expect(error.status).toEqual(503);
      expect(error.label).toEqual("DB");
      expect(error.message).not.toContain("does not exist");
      expect(error.cause).toBe(wrappedCause);
    });

    it("should return a 503 DB error when connection error is nested two ShelfError layers deep", () => {
      const dbError = Object.assign(new Error("Connection failure"), {
        code: "08006",
      });
      const innerCause = new ShelfError({
        cause: dbError,
        label: "User",
        message: "The user you are trying to access does not exist",
        status: 404,
      });
      const outerCause = new ShelfError({
        cause: innerCause,
        label: "Booking",
        message: "Booking not found",
        status: 404,
      });

      const error = makeShelfError(outerCause);

      expect(error.status).toEqual(503);
      expect(error.label).toEqual("DB");
      expect(error.message).toContain("temporary database connectivity");
    });

    it("should preserve domain errors for PGRST116 (not found)", () => {
      const dbError = Object.assign(new Error("No rows found"), {
        code: "PGRST116",
      });
      const wrappedCause = new ShelfError({
        cause: dbError,
        label: "User",
        message: "The user you are trying to access does not exist",
        status: 404,
      });

      const error = makeShelfError(wrappedCause);

      expect(error.status).toEqual(404);
      expect(error.label).toEqual("User");
      expect(error.message).toContain("does not exist");
    });
  });

  describe("cause is unknown", () => {
    it("should forward additionalData", () => {
      const cause = new Error("I am an error");

      expect(
        makeShelfError(cause, {
          userId: "user-id",
        })
      ).toEqual(
        new ShelfError({
          cause,
          message: "Sorry, something went wrong.",
          label: "Unknown",
          additionalData: {
            userId: "user-id",
          },
        })
      );
    });

    it("should return a default ShelfError if cause is an instance of Error", () => {
      const cause = new Error("I am an error");

      expect(makeShelfError(cause)).toEqual(
        new ShelfError({
          cause,
          message: "Sorry, something went wrong.",
          label: "Unknown",
        })
      );
    });

    it("should return a default ShelfError if cause is really unknown", () => {
      const cause = "I am an error";

      expect(makeShelfError(cause)).toEqual(
        new ShelfError({
          cause,
          message: "Sorry, something went wrong.",
          label: "Unknown",
        })
      );
    });
  });
});

describe(isLikeShelfError.name, () => {
  it("should return true for a ShelfError instance", () => {
    expect(
      isLikeShelfError(
        new ShelfError({
          cause: null,
          label: "Unknown",
          message: "I am an error",
        })
      )
    ).toBeTruthy();
  });

  it("should return true for an object that looks like a ShelfError", () => {
    expect(
      isLikeShelfError({
        cause: null,
        label: "Unknown",
        message: "I am an error",
      })
    ).toBeTruthy();
  });

  it("should return false for an Error instance", () => {
    expect(isLikeShelfError(new Error("I am an error"))).toBeFalsy();
  });

  it("should return false for an object that doesn't look like a ShelfError", () => {
    expect(
      isLikeShelfError({
        cause: null,
        message: "I am an error",
      })
    ).toBeFalsy();
  });
});

describe(ShelfError.name, () => {
  describe("cause is like a ShelfError", () => {
    it("should use the cause's status", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        message: "I am the root cause",
        status: 404,
      });
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.status).toEqual(cause.status);
    });

    it("should use the provided status if the cause has no status", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        message: "I am the root cause",
      });
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
        status: 400,
      });

      expect(error.status).toEqual(400);
    });

    it("should status default to 500", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        message: "I am the root cause",
      });
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.status).toEqual(500);
    });

    it("should use the cause's title", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        title: "Root cause",
        message: "I am the root cause",
      });
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.title).toEqual(cause.title);
    });

    it("should use the provided title if the cause has no title", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        message: "I am the root cause",
      });
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
        title: "An error occurred",
      });

      expect(error.title).toEqual("An error occurred");
    });

    it("should title default to undefined", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        message: "I am the root cause",
      });
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.title).toBeUndefined();
    });

    it("should use the cause's shouldBeCaptured", () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        title: "Root cause",
        message: "I am the root cause",
        shouldBeCaptured: false,
      });
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.shouldBeCaptured).toEqual(cause.shouldBeCaptured);
    });

    it(`should use the provided shouldBeCaptured if the cause has no shouldBeCaptured`, () => {
      const cause = new ShelfError({
        cause: null,
        label: "Unknown",
        title: "Root cause",
        message: "I am the root cause",
      });
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
        shouldBeCaptured: false,
      });

      expect(error.shouldBeCaptured).toBeFalsy();
    });

    it(`should shouldBeCaptured default to true`, () => {
      const error = new ShelfError({
        cause: null,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.shouldBeCaptured).toBeTruthy();
    });
  });

  describe("cause is an Error", () => {
    it("should use the provided status if the cause has no status", () => {
      const cause = new Error("I am the root cause");
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
        status: 400,
      });

      expect(error.status).toEqual(400);
    });

    it("should status default to 500", () => {
      const cause = new Error("I am the root cause");
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.status).toEqual(500);
    });

    it("should use the provided title if the cause has no title", () => {
      const cause = new Error("I am the root cause");
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
        title: "An error occurred",
      });

      expect(error.title).toEqual("An error occurred");
    });

    it("should shouldBeCaptured default to true", () => {
      const cause = new Error("I am the root cause");
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.shouldBeCaptured).toBeTruthy();
    });

    it("should title default to undefined", () => {
      const cause = new Error("I am the root cause");
      const error = new ShelfError({
        cause,
        label: "Unknown",
        message: "I am an error",
      });

      expect(error.title).toBeUndefined();
    });
  });
});

describe(isTransientError.name, () => {
  it.each(["08000", "08003", "08006", "57014", "57P01"])(
    "should return true for transient Postgres error code %s",
    (code) => {
      const error = Object.assign(new Error("some error"), { code });
      expect(isTransientError(error)).toBe(true);
    }
  );

  it("should return false for 23505 (unique violation)", () => {
    const error = Object.assign(new Error("Unique constraint"), {
      code: "23505",
    });
    expect(isTransientError(error)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isTransientError(null)).toBe(false);
  });

  it("should return false for a plain Error without code", () => {
    expect(isTransientError(new Error("something"))).toBe(false);
  });

  it.each([
    "Timed out fetching a new connection from the connection pool",
    "Timed out fetching a new connection from the pool",
    "Can't reach database server at host:5432",
  ])("should detect transient error by message: %s", (message) => {
    const error = new Error(message);
    expect(isTransientError(error)).toBe(true);
  });
});
