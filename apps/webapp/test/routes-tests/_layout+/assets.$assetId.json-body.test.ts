// @vitest-environment node
/**
 * The asset detail action answers a body that is not a form with a 400 that
 * says a form is expected, not a 500.
 *
 * Scripts and browser agents post JSON to route actions. The action reads
 * its body through `readFormData`, which turns Node's
 * "Content-Type was not one of ..." `TypeError` into that 400.
 *
 * Runs in the Node environment: happy-dom's `Request` throws a different
 * error for the same body, so only Node shows what production does.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.$assetId.tsx}
 * @see {@link file://./../../../app/utils/http.server.ts} `readFormData`
 */
import { describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { archiveAsset } from "~/modules/asset/service.server";
import { requirePermission } from "~/utils/roles.server";

// why: the permission check reads the session cookie and the database; the
// body is rejected before it would run.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the writes behind the intents; none may be reached.
vi.mock("~/modules/asset/service.server", () => ({
  archiveAsset: vi.fn(),
  unarchiveAsset: vi.fn(),
  deleteAsset: vi.fn(),
  deleteOtherImages: vi.fn(),
  getAsset: vi.fn(),
  relinkAssetQrCode: vi.fn(),
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: importing the route reaches `db.server`, which connects at module
// scope; nothing here may touch the database.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the route's modules report through Sentry at import and on error;
// no reporting is under test
vi.mock("@sentry/react-router", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// why: the route transitively imports the scanner success animation, and
// lottie-web touches canvas APIs at import; only the action runs here
vi.mock("lottie-react", () => ({ default: () => null }));

const { action } = await import("~/routes/_layout+/assets.$assetId");

describe("asset detail action: a body that is not a form", () => {
  it("answers a JSON body with a 400 that says a form is expected", async () => {
    const response = await action(
      createActionArgs({
        request: new Request("http://localhost/assets/a1?intent=archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "archive" }),
        }),
        params: { assetId: "a1" },
        context: { getSession: () => ({ userId: "user-1" }) } as never,
      })
    );

    expect(response).toMatchObject({
      init: { status: 400 },
      data: {
        error: {
          message: "Invalid request body. Expected a form submission.",
        },
      },
    });
    expect(requirePermission).not.toHaveBeenCalled();
    expect(archiveAsset).not.toHaveBeenCalled();
  });
});
