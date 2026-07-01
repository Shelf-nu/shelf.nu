// @vitest-environment node
import * as Sentry from "@sentry/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "./error";
import { Logger } from "./logger";

// why: handledClientError emits to Sentry's structured-log API; capture the
// calls instead of hitting the network. captureException is stubbed too because
// Logger.error uses it.
vi.mock("@sentry/react-router", () => ({
  captureException: vi.fn(),
  logger: { info: vi.fn() },
}));

// why: handledClientError early-returns unless a SENTRY_DSN is configured, and
// the module also reads `env`; provide both so the emit path is exercised.
vi.mock("./env", () => ({
  SENTRY_DSN: "https://test@example.ingest.sentry.io/1",
  env: { NODE_ENV: "test" },
}));

const make4xx = (overrides: Record<string, unknown> = {}) =>
  new ShelfError({
    cause: null,
    message: "Please select a date in the future",
    label: "Request validation",
    status: 400,
    ...overrides,
  });

describe("Logger.handledClientError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a low-severity Sentry log for a 4xx ShelfError", () => {
    Logger.handledClientError(make4xx());

    expect(Sentry.logger.info).toHaveBeenCalledWith(
      "Please select a date in the future",
      expect.objectContaining({ status: 400, label: "Request validation" })
    );
  });

  it("does not emit for a 5xx ShelfError (server fault stays an error event)", () => {
    Logger.handledClientError(make4xx({ status: 500 }));
    expect(Sentry.logger.info).not.toHaveBeenCalled();
  });

  it("attaches the userId when present", () => {
    Logger.handledClientError(
      make4xx({ additionalData: { userId: "real-user-1" } })
    );
    expect(Sentry.logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ userId: "real-user-1" })
    );
  });
});
