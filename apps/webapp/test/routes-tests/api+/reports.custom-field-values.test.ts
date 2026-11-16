/**
 * The report filter bar's TEXT custom-field values route.
 *
 * The plan gate is covered with every other report door in
 * `reports-plan-gate.test.ts`; these cases pin what the route reads and
 * hands back once the caller is through it.
 *
 * @see {@link file://../../../app/routes/api+/reports.custom-field-values.ts}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

// why: permission and membership resolution read the session and the
// database; these cases are about the payload, so the caller is a member of
// org-1 with `reports: read`.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(() =>
    Promise.resolve({ organizationId: "org-1", organizations: [] })
  ),
}));

// why: the plan check reads the owner's tier from the database; it is
// covered in reports-plan-gate.test.ts, so here the plan includes reports.
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanUseReports: vi.fn(() => Promise.resolve()),
}));

// why: the values are an aggregate query over the workspace's assets; the
// loader's contract is to scope it to the session's workspace and pass the
// result through.
vi.mock("~/modules/reports/filters.server", () => ({
  loadCustomFieldValues: vi.fn(),
}));

import { loadCustomFieldValues } from "~/modules/reports/filters.server";
import { loader } from "~/routes/api+/reports.custom-field-values";

/** Calls the loader as a signed-in user with `query` as the search string. */
function run(query: string) {
  return loader(
    createLoaderArgs({
      request: new Request(
        `http://localhost:3000/api/reports/custom-field-values${query}`
      ),
      context: {
        getSession: () => ({ userId: "user-1" }),
      } as never,
    })
  );
}

describe("api/reports/custom-field-values", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the field's values in the session's workspace", async () => {
    vi.mocked(loadCustomFieldValues).mockResolvedValue({
      values: ["Perkins", "General"],
      hasMore: true,
    });

    const result = (await run("?customFieldId=f-1")) as unknown as {
      data: Record<string, unknown>;
    };

    expect(loadCustomFieldValues).toHaveBeenCalledWith({
      organizationId: "org-1",
      customFieldId: "f-1",
    });
    expect(result.data).toMatchObject({
      customFieldId: "f-1",
      values: ["Perkins", "General"],
      hasMore: true,
    });
  });

  it("refuses a request without a field id", async () => {
    let thrown: unknown;
    try {
      await run("");
    } catch (cause) {
      thrown = cause;
    }

    expect((thrown as { init?: { status?: number } }).init?.status).toBe(400);
    expect(loadCustomFieldValues).not.toHaveBeenCalled();
  });
});
