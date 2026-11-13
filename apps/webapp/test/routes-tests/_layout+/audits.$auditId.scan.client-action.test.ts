/**
 * Audit scanner: which saves keep the page when they get no answer.
 *
 * Only completing the audit does. Removing a scan is submitted in the
 * background and nothing reads its result, so a failure there has to keep
 * reaching the error boundary: returned as action data it would hide a removal
 * the server never made.
 *
 * @see {@link file://./../../../app/routes/_layout+/audits.$auditId.scan.tsx}
 */
import type { ClientActionFunctionArgs } from "react-router";
import { UNSAFE_ErrorResponseImpl as ErrorResponseImpl } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { clientAction } from "~/routes/_layout+/audits.$auditId.scan";

// @vitest-environment node

// why: the route module imports the real Prisma client transitively; the
// client action under test never touches it.
vi.mock("~/database/db.server", () => ({ db: {} }));

/** What React Router throws when a gateway answers with its own 524 page. */
function gatewayTimeout() {
  return new ErrorResponseImpl(524, "", "<html>gateway page</html>");
}

/**
 * Runs the client action for a submission to `url` whose server action gets a
 * gateway timeout.
 */
function submitTo(url: string, thrown: unknown) {
  const args = {
    request: new Request(url, { method: "POST", body: new FormData() }),
    params: { auditId: "audit-1" },
    context: {},
    serverAction: () => Promise.reject(thrown),
  } as unknown as ClientActionFunctionArgs;

  return clientAction(args);
}

const SCAN_URL = "http://localhost/audits/audit-1/scan";

describe("audit scan client action", () => {
  it("keeps the page when completing the audit gets no answer", async () => {
    const result = await submitTo(
      `${SCAN_URL}?intent=complete-audit`,
      gatewayTimeout()
    );

    expect(result).toMatchObject({
      data: { scanSubmitFailure: { kind: "timeout", status: 524 } },
    });
  });

  it.each([
    ["a scan removal", `${SCAN_URL}?intent=remove-scan`],
    ["a submission with no intent in the URL", SCAN_URL],
  ])("lets %s fail loudly", async (_label, url) => {
    const thrown = gatewayTimeout();

    await expect(submitTo(url, thrown)).rejects.toBe(thrown);
  });
});
