/**
 * Report page loaders: a member without report access gets a 403 response,
 * not a server error.
 *
 * The reports index and the single-report page are reachable by URL even for
 * roles whose sidebar hides Reports (Manager, Self service, Base). Their
 * loaders must turn a refused permission, and an unknown report, into a
 * response that carries the real status, so the error page reads "no
 * permission" or "not found" instead of a 500.
 *
 * @see {@link file://../../../app/routes/_layout+/reports._index.tsx}
 * @see {@link file://../../../app/routes/_layout+/reports.$reportId.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { loader as reportLoader } from "~/routes/_layout+/reports.$reportId";
import { loader as reportsIndexLoader } from "~/routes/_layout+/reports._index";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: the role under test is expressed by what the permission check does;
// the real check reads the caller's membership from the database.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the route answers failures with react-router's data(), which returns a
// DataWithResponseInit rather than a Response; mocking it to a real Response is
// the convention the other route tests use, and lets the status be asserted.
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: vi.fn(
    (payload: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(payload), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      })
  ),
}));

/** The refusal requirePermission throws for a role without report access. */
const NO_REPORT_ACCESS = new ShelfError({
  cause: null,
  message: "You have no permission to perform this action",
  label: "Permission",
  status: 403,
  shouldBeCaptured: false,
});

/** Loader args for the given report URL, signed in as a member. */
function argsFor(path: string, params: Record<string, string> = {}) {
  return createLoaderArgs({
    request: new Request(`http://localhost${path}`),
    params,
    context: { getSession: () => ({ userId: "user-1" }) },
  } as never);
}

/** Runs a loader that is expected to throw, and returns the thrown Response. */
async function thrownResponse(run: () => Promise<unknown>): Promise<Response> {
  try {
    await run();
  } catch (thrown) {
    return thrown as Response;
  }
  throw new Error("expected the loader to throw");
}

describe("report page loaders", () => {
  beforeEach(() => {
    vi.mocked(requirePermission).mockReset();
  });

  it("answers 403 on the reports index for a member without report access", async () => {
    vi.mocked(requirePermission).mockRejectedValue(NO_REPORT_ACCESS);

    const response = await thrownResponse(() =>
      reportsIndexLoader(argsFor("/reports"))
    );

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(403);
  });

  it("answers 403 on a single report for a member without report access", async () => {
    vi.mocked(requirePermission).mockRejectedValue(NO_REPORT_ACCESS);

    const response = await thrownResponse(() =>
      reportLoader(
        argsFor("/reports/booking-compliance", {
          reportId: "booking-compliance",
        })
      )
    );

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(403);
  });

  it("answers 404 for a report that does not exist", async () => {
    const response = await thrownResponse(() =>
      reportLoader(
        argsFor("/reports/no-such-report", { reportId: "no-such-report" })
      )
    );

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(404);
    expect(requirePermission).not.toHaveBeenCalled();
  });
});
