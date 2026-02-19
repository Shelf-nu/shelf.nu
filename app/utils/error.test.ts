import {
  ShelfError,
  isLikeShelfError,
  isPrismaTransientError,
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
  describe("cause is a transient Prisma error", () => {
    it("should return a 503 DB error for a direct P2024 cause", () => {
      const cause = Object.assign(new Error("Connection pool timeout"), {
        code: "P2024",
      });

      const error = makeShelfError(cause);

      expect(error.status).toEqual(503);
      expect(error.label).toEqual("DB");
      expect(error.message).toContain("temporary database connectivity");
    });

    it("should return a 503 DB error when P2024 is wrapped in a ShelfError", () => {
      const prismaError = Object.assign(new Error("Connection pool timeout"), {
        code: "P2024",
      });
      const wrappedCause = new ShelfError({
        cause: prismaError,
        label: "User",
        message: "The user you are trying to access does not exist",
        status: 404,
      });

      const error = makeShelfError(wrappedCause);

      expect(error.status).toEqual(503);
      expect(error.label).toEqual("DB");
      expect(error.message).not.toContain("does not exist");
    });

    it("should preserve domain errors for genuine P2025 (not found)", () => {
      const prismaError = Object.assign(new Error("Record not found"), {
        code: "P2025",
      });
      const wrappedCause = new ShelfError({
        cause: prismaError,
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

describe(isPrismaTransientError.name, () => {
  it.each(["P2024", "P1001", "P1002", "P1008", "P1017"])(
    "should return true for transient error code %s",
    (code) => {
      const error = Object.assign(new Error("some error"), { code });
      expect(isPrismaTransientError(error)).toBe(true);
    }
  );

  it("should return false for P2025 (not found)", () => {
    const error = Object.assign(new Error("Record not found"), {
      code: "P2025",
    });
    expect(isPrismaTransientError(error)).toBe(false);
  });

  it("should return false for null", () => {
    expect(isPrismaTransientError(null)).toBe(false);
  });

  it("should return false for a plain Error without code", () => {
    expect(isPrismaTransientError(new Error("something"))).toBe(false);
  });

  it("should detect transient error by message content", () => {
    const error = new Error(
      "Timed out fetching a new connection from the pool"
    );
    expect(isPrismaTransientError(error)).toBe(true);
  });
});
