import {
  ShelfError,
  isAssetQuantityOverAllocationError,
  isDbResourceExhaustionError,
  isHandledClientError,
  isIndividualAssetAlreadyPlacedError,
  isLikeShelfError,
  isPrismaTransientError,
  makeShelfError,
  notAllowedMethod,
  throwIfAssetQuantityOverAllocation,
  throwIfIndividualAssetAlreadyPlaced,
} from "./error";

/**
 * Realistic Prisma message for a Postgres shared-lock-table exhaustion
 * (SQLSTATE 53200). Prisma surfaces this as a P2010 (raw query failed) whose
 * `.message` embeds the Postgres error + hint verbatim. Mirrors the payload
 * captured in SHELF-WEBAPP-227.
 */
const LOCK_EXHAUSTION_MESSAGE =
  "\nInvalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `53200`. Message: `ERROR: out of shared memory\nHINT: You might need to increase max_locks_per_transaction.`";

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
      expect(error.cause).toBe(wrappedCause);
    });

    it("should return a 503 DB error when P2024 is nested two ShelfError layers deep", () => {
      const prismaError = Object.assign(new Error("Connection pool timeout"), {
        code: "P2024",
      });
      const innerCause = new ShelfError({
        cause: prismaError,
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

  describe("cause is a DB resource-exhaustion (lock table) error", () => {
    it("maps a direct 53200 lock-exhaustion error to a friendly retryable 503", () => {
      const cause = Object.assign(new Error(LOCK_EXHAUSTION_MESSAGE), {
        code: "P2010",
      });

      const error = makeShelfError(cause);

      expect(error.status).toEqual(503);
      expect(error.label).toEqual("DB");
      expect(error.message.toLowerCase()).toContain("temporarily overloaded");
    });

    it("maps 53200 to 503 even when wrapped in a generic 500 ShelfError", () => {
      // Mirrors the real path: the assets query catch re-wraps the raw Prisma
      // error into a generic "Failed to fetch…" 500 before it reaches the
      // route boundary where makeShelfError runs.
      const prismaError = Object.assign(new Error(LOCK_EXHAUSTION_MESSAGE), {
        code: "P2010",
      });
      const wrappedCause = new ShelfError({
        cause: prismaError,
        label: "Assets",
        message: "Failed to fetch paginated and filterable assets",
      });

      const error = makeShelfError(wrappedCause);

      expect(error.status).toEqual(503);
      expect(error.label).toEqual("DB");
      expect(error.message).not.toContain("Failed to fetch");
      expect(error.cause).toBe(wrappedCause);
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

  it.each([
    "Timed out fetching a new connection from the connection pool",
    "Timed out fetching a new connection from the pool",
    "Can't reach database server at host:5432",
  ])("should detect transient error by message: %s", (message) => {
    const error = new Error(message);
    expect(isPrismaTransientError(error)).toBe(true);
  });

  it("should return false for an Error whose message has been overwritten to undefined", () => {
    // Guards against a regression where a ShelfError built with
    // `message: undefined` would crash `cause.message.toLowerCase()`.
    const error = new Error("original");
    // @ts-expect-error — simulate the bad ShelfError construction path
    error.message = undefined;
    expect(() => isPrismaTransientError(error)).not.toThrow();
    expect(isPrismaTransientError(error)).toBe(false);
  });
});

describe(isDbResourceExhaustionError.name, () => {
  it("detects a direct Postgres 53200 lock-table-exhaustion error", () => {
    const error = Object.assign(new Error(LOCK_EXHAUSTION_MESSAGE), {
      code: "P2010",
    });
    expect(isDbResourceExhaustionError(error)).toBe(true);
  });

  it("detects it when wrapped inside a ShelfError cause chain", () => {
    const prismaError = Object.assign(new Error(LOCK_EXHAUSTION_MESSAGE), {
      code: "P2010",
    });
    const wrapped = new ShelfError({
      cause: prismaError,
      label: "Assets",
      message: "Failed to fetch paginated and filterable assets",
    });
    expect(isDbResourceExhaustionError(wrapped)).toBe(true);
  });

  it("does NOT match a generic P2010 raw-query failure (e.g. a bad column)", () => {
    // A genuinely broken raw query is also a P2010 — matching on the bare
    // P2010 code would swallow real bugs. We match only the 53200 signature.
    const error = Object.assign(
      new Error(
        '\nInvalid `prisma.$queryRaw()` invocation:\n\nRaw query failed. Code: `42703`. Message: `column "foo" does not exist`'
      ),
      { code: "P2010" }
    );
    expect(isDbResourceExhaustionError(error)).toBe(false);
  });

  it("returns false for unrelated errors and non-objects", () => {
    expect(isDbResourceExhaustionError(new Error("boom"))).toBe(false);
    expect(isDbResourceExhaustionError(null)).toBe(false);
    expect(isDbResourceExhaustionError(undefined)).toBe(false);
  });
});

describe(notAllowedMethod.name, () => {
  it("uses the default message when no options are provided", () => {
    const error = notAllowedMethod("POST");
    expect(error.message).toBe(`"POST" method is not allowed.`);
    expect(error.status).toBe(405);
  });

  it("uses the default message when options.message is explicitly undefined", () => {
    // Reproduces the historical bug where `assertIsPost(request)` (no message
    // argument) called `notAllowedMethod("POST", { message: undefined })` and
    // clobbered the default via spread semantics, producing a message-less
    // ShelfError that later crashed `isPrismaTransientError`.
    const error = notAllowedMethod("POST", { message: undefined });
    expect(error.message).toBe(`"POST" method is not allowed.`);
  });

  it("respects a caller-provided message override", () => {
    const error = notAllowedMethod("POST", {
      message: "Only POST is accepted here.",
    });
    expect(error.message).toBe("Only POST is accepted here.");
  });

  it("produces an error that flows through makeShelfError without throwing", () => {
    const error = notAllowedMethod("POST");
    expect(() => makeShelfError(error)).not.toThrow();
  });
});

describe(isAssetQuantityOverAllocationError.name, () => {
  // why: emulate the runtime shape of the trigger violation — a
  // `PrismaClientUnknownRequestError` is just an Error whose `message` carries
  // the raw `RAISE EXCEPTION` text. We don't import the Prisma class to keep
  // this a pure unit test.
  const assetKitTriggerError = new Error(
    "Invalid `prisma.assetKit.createMany()` invocation: AssetKit total 6 exceeds Asset.quantity 3 for asset abc123"
  );
  const assetLocationTriggerError = new Error(
    "Invalid `prisma.assetLocation.createMany()` invocation: AssetLocation total 2 exceeds Asset.quantity 1 for asset abc123"
  );

  it("detects the AssetKit over-allocation trigger message", () => {
    expect(isAssetQuantityOverAllocationError(assetKitTriggerError)).toBe(true);
  });

  it("detects the AssetLocation over-allocation trigger message", () => {
    expect(isAssetQuantityOverAllocationError(assetLocationTriggerError)).toBe(
      true
    );
  });

  it("detects the trigger error when wrapped inside a ShelfError", () => {
    const wrapped = new ShelfError({
      cause: assetKitTriggerError,
      label: "Kit",
      message: "Something went wrong while updating kit assets.",
    });
    expect(isAssetQuantityOverAllocationError(wrapped)).toBe(true);
  });

  it("detects the trigger error nested two ShelfError layers deep", () => {
    const inner = new ShelfError({
      cause: assetLocationTriggerError,
      label: "Location",
      message: "Something went wrong while updating the location assets.",
    });
    const outer = new ShelfError({
      cause: inner,
      label: "Location",
      message: "wrapper",
    });
    expect(isAssetQuantityOverAllocationError(outer)).toBe(true);
  });

  it("does NOT match unrelated errors", () => {
    expect(isAssetQuantityOverAllocationError(new Error("boom"))).toBe(false);
    // A different Prisma unique-constraint violation must not be swallowed.
    expect(
      isAssetQuantityOverAllocationError(
        new Error("Unique constraint failed on the fields: (`qrId`)")
      )
    ).toBe(false);
    // Another trigger that mentions the same tables but a DIFFERENT invariant.
    expect(
      isAssetQuantityOverAllocationError(
        new Error("INDIVIDUAL asset abc123 already linked to a kit")
      )
    ).toBe(false);
    expect(isAssetQuantityOverAllocationError(null)).toBe(false);
    expect(isAssetQuantityOverAllocationError("exceeds Asset.quantity")).toBe(
      false
    );
  });

  it("returns false (does not stack-overflow) on a self-referential cause cycle", () => {
    // why: a malformed error whose `.cause` points at itself must terminate the
    // walk instead of recursing forever — the visited-set guards against it.
    const cyclic: { message: string; cause?: unknown } = { message: "boom" };
    cyclic.cause = cyclic;
    expect(isAssetQuantityOverAllocationError(cyclic)).toBe(false);
  });

  it("returns false on a two-object cause cycle", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    const b: { message: string; cause?: unknown } = { message: "b", cause: a };
    a.cause = b; // a -> b -> a
    expect(isAssetQuantityOverAllocationError(a)).toBe(false);
  });

  it("still detects the marker even when the cause graph is cyclic", () => {
    // The marker on an outer node is found before the cycle is revisited.
    const inner: { message: string; cause?: unknown } = { message: "inner" };
    const outer: { message: string; cause?: unknown } = {
      message: "AssetKit total 6 exceeds Asset.quantity 3 for asset abc123",
      cause: inner,
    };
    inner.cause = outer; // cycle, but the marker is on `outer`
    expect(isAssetQuantityOverAllocationError(outer)).toBe(true);
  });
});

describe(throwIfAssetQuantityOverAllocation.name, () => {
  const triggerError = new Error(
    "AssetKit total 6 exceeds Asset.quantity 3 for asset abc123"
  );

  it("throws a friendly 400, non-captured ShelfError for the trigger violation", () => {
    let thrown: unknown;
    try {
      throwIfAssetQuantityOverAllocation(triggerError, {
        label: "Kit",
        additionalData: { kitId: "kit-1", assetIds: ["a1"] },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const shelfError = thrown as ShelfError;
    expect(shelfError.status).toBe(400);
    expect(shelfError.shouldBeCaptured).toBe(false);
    expect(shelfError.label).toBe("Kit");
    expect(shelfError.cause).toBe(triggerError);
    expect(shelfError.additionalData).toEqual({
      kitId: "kit-1",
      assetIds: ["a1"],
    });
    // Non-technical, actionable user message.
    expect(shelfError.message).toContain("Lower the quantity");
  });

  it("also translates the AssetLocation variant", () => {
    expect(() =>
      throwIfAssetQuantityOverAllocation(
        new Error("AssetLocation total 2 exceeds Asset.quantity 1 for asset x"),
        { label: "Location" }
      )
    ).toThrow(ShelfError);
  });

  it("does NOT throw (passes through) for any other error", () => {
    expect(() =>
      throwIfAssetQuantityOverAllocation(new Error("some other DB error"), {
        label: "Assets",
      })
    ).not.toThrow();
    expect(() =>
      throwIfAssetQuantityOverAllocation(null, { label: "Assets" })
    ).not.toThrow();
  });

  it("resulting error is a handled client error (Sentry log, not issue)", () => {
    let thrown: unknown;
    try {
      throwIfAssetQuantityOverAllocation(triggerError, { label: "Assets" });
    } catch (error) {
      thrown = error;
    }
    // 400 → routed to Sentry logs, kept out of the error/issue pipeline.
    expect(isHandledClientError(thrown)).toBe(true);
  });
});

describe(isIndividualAssetAlreadyPlacedError.name, () => {
  // why: emulate the runtime shape of the trigger violation — a
  // `PrismaClientUnknownRequestError` is just an Error whose `message` carries
  // the raw `RAISE EXCEPTION` text.
  const singleLocationTriggerError = new Error(
    "Invalid `prisma.assetLocation.createMany()` invocation: INDIVIDUAL asset abc123 already placed at a location"
  );

  it("detects the single-location trigger message", () => {
    expect(
      isIndividualAssetAlreadyPlacedError(singleLocationTriggerError)
    ).toBe(true);
  });

  it("detects the trigger error nested two ShelfError layers deep", () => {
    const inner = new ShelfError({
      cause: singleLocationTriggerError,
      label: "Location",
      message:
        "Something went wrong while adding the kits to the location. Please try again or contact support.",
    });
    const outer = new ShelfError({
      cause: inner,
      label: "Location",
      message: "Something went wrong while updating the location kits.",
    });
    expect(isIndividualAssetAlreadyPlacedError(outer)).toBe(true);
  });

  it("does NOT match the quantity over-allocation trigger or unrelated errors", () => {
    // The two pivot triggers must stay distinct so each maps to its own message.
    expect(
      isIndividualAssetAlreadyPlacedError(
        new Error("AssetLocation total 2 exceeds Asset.quantity 1 for asset x")
      )
    ).toBe(false);
    // The sibling single-kit trigger has different wording.
    expect(
      isIndividualAssetAlreadyPlacedError(
        new Error("INDIVIDUAL asset abc123 already linked to a kit")
      )
    ).toBe(false);
    expect(isIndividualAssetAlreadyPlacedError(new Error("boom"))).toBe(false);
    expect(isIndividualAssetAlreadyPlacedError(null)).toBe(false);
  });

  it("returns false (does not stack-overflow) on a self-referential cause cycle", () => {
    const cyclic: { message: string; cause?: unknown } = { message: "boom" };
    cyclic.cause = cyclic;
    expect(isIndividualAssetAlreadyPlacedError(cyclic)).toBe(false);
  });
});

describe(throwIfIndividualAssetAlreadyPlaced.name, () => {
  const triggerError = new Error(
    "INDIVIDUAL asset abc123 already placed at a location"
  );

  it("throws a friendly 400, non-captured ShelfError for the trigger violation", () => {
    let thrown: unknown;
    try {
      throwIfIndividualAssetAlreadyPlaced(triggerError, {
        label: "Location",
        additionalData: { locationId: "loc-1", kitIds: ["k1"] },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const shelfError = thrown as ShelfError;
    expect(shelfError.status).toBe(400);
    expect(shelfError.shouldBeCaptured).toBe(false);
    expect(shelfError.label).toBe("Location");
    expect(shelfError.cause).toBe(triggerError);
    expect(shelfError.additionalData).toEqual({
      locationId: "loc-1",
      kitIds: ["k1"],
    });
    // Non-technical, actionable user message.
    expect(shelfError.message).toContain("one location at a time");
    // 400 → routed to Sentry logs, kept out of the error/issue pipeline.
    expect(isHandledClientError(shelfError)).toBe(true);
  });

  it("does NOT throw (passes through) for any other error", () => {
    expect(() =>
      throwIfIndividualAssetAlreadyPlaced(
        new Error("AssetLocation total 2 exceeds Asset.quantity 1 for asset x"),
        { label: "Location" }
      )
    ).not.toThrow();
    expect(() =>
      throwIfIndividualAssetAlreadyPlaced(null, { label: "Location" })
    ).not.toThrow();
  });
});

describe(isHandledClientError.name, () => {
  it("is true for a 4xx ShelfError", () => {
    for (const status of [400, 401, 403, 404, 405, 409, 429, 499] as const) {
      expect(
        isHandledClientError(
          new ShelfError({ cause: null, message: "x", label: "Assets", status })
        )
      ).toBe(true);
    }
  });

  it("is false for a 5xx ShelfError and for the default (500) status", () => {
    expect(
      isHandledClientError(
        new ShelfError({
          cause: null,
          message: "x",
          label: "Assets",
          status: 500,
        })
      )
    ).toBe(false);
    // No explicit status → ShelfError defaults to 500 → treated as a server error.
    expect(
      isHandledClientError(
        new ShelfError({ cause: null, message: "x", label: "Assets" })
      )
    ).toBe(false);
  });

  it("is false for non-ShelfError values", () => {
    expect(isHandledClientError(new Error("boom"))).toBe(false);
    expect(isHandledClientError(null)).toBe(false);
    expect(isHandledClientError({ status: 400 })).toBe(false);
  });
});
