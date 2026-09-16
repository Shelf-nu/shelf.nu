/**
 * Route tests for the saved-report action on the report builder page.
 *
 * The action is the only write path for saved reports, so the assertions are
 * about who may write and what reaches the service: the caller's workspace
 * (never one from the form), the locked-workspace refusal, and the failure
 * statuses the dialogs show under the name field.
 *
 * @see {@link file://../../../app/routes/_layout+/reports.builder.tsx}
 * @see {@link file://../../../app/modules/reports/saved/service.server.ts}
 */
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";
import {
  createSavedReport,
  deleteSavedReport,
  renameSavedReport,
} from "~/modules/reports/saved/service.server";
import { ShelfError } from "~/utils/error";
import { validateAdvancedReportsEnabled } from "~/utils/permissions/advanced-reports.validator.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { action } from "~/routes/_layout+/reports.builder";

// why: the action's contract with the permission layer is the arguments it
// passes; the real check needs the database.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the add-on gate reads the premium flag from config; each case decides
// whether the workspace is locked.
vi.mock("~/utils/permissions/advanced-reports.validator.server", () => ({
  validateAdvancedReportsEnabled: vi.fn(),
}));

// why: the service owns the database work and has its own tests; here only
// the arguments and the propagated failures matter.
vi.mock("~/modules/reports/saved/service.server", () => ({
  listSavedReports: vi.fn(),
  createSavedReport: vi.fn(),
  renameSavedReport: vi.fn(),
  deleteSavedReport: vi.fn(),
}));

// why: the loader in the same route file imports the query compiler and the
// filter resolver, which need the database; the action never calls them.
vi.mock("~/modules/reports/builder/compile.server", () => ({
  runBuilderReport: vi.fn(),
}));
vi.mock("~/modules/reports/filters.server", () => ({
  resolveReportFilters: vi.fn(),
  loadReportFilterOptions: vi.fn(),
}));
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(),
}));

const requirePermissionMock = requirePermission as Mock;
const validateMock = validateAdvancedReportsEnabled as Mock;
const createMock = createSavedReport as Mock;
const renameMock = renameSavedReport as Mock;
const deleteMock = deleteSavedReport as Mock;

const ORG = { id: "org-1", advancedReportsEnabled: true };

function post(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return createActionArgs({
    request: new Request("http://localhost:3000/reports/builder", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }),
    context: {
      getSession: () => ({ userId: "user-1" }),
    } as unknown as Record<string, unknown>,
  });
}

/** Reads the body and status out of either a plain payload or `data()`. */
function unwrap(result: unknown) {
  const r = result as { data?: unknown; init?: { status?: number } };
  return r && typeof r === "object" && "init" in r
    ? { body: r.data as Record<string, unknown>, status: r.init?.status }
    : { body: result as Record<string, unknown>, status: 200 };
}

describe("reports.builder action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: ORG,
      role: "ADMIN",
    });
    validateMock.mockImplementation(() => undefined);
  });

  it("requires reports:read and the add-on before saving", async () => {
    createMock.mockResolvedValue({ id: "rep-1", name: "Laptops", query: "" });

    const result = await action(
      post({
        intent: "save-report",
        name: "Laptops",
        query: "dataset=assets&groupBy=category&measure=assetCount",
      })
    );

    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        entity: PermissionEntity.reports,
        action: PermissionAction.read,
      })
    );
    expect(validateMock).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ userId: "user-1", intent: "save-report" })
    );
    expect(createMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      createdById: "user-1",
      name: "Laptops",
      query: "dataset=assets&groupBy=category&measure=assetCount",
    });
    expect(unwrap(result).body.savedReport).toEqual(
      expect.objectContaining({ id: "rep-1" })
    );
  });

  it("refuses every intent for a workspace without the add-on", async () => {
    validateMock.mockImplementation(() => {
      throw new ShelfError({
        cause: null,
        message: "The report builder is not enabled for this workspace",
        status: 403,
        label: "Report",
      });
    });

    const { status } = unwrap(
      await action(post({ intent: "delete-report", reportId: "rep-1" }))
    );

    expect(status).toBe(403);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("scopes a rename to the caller's workspace", async () => {
    renameMock.mockResolvedValue({ id: "rep-1", name: "New", query: "" });

    await action(
      post({
        intent: "rename-report",
        reportId: "rep-1",
        name: "New",
        organizationId: "org-evil",
      })
    );

    expect(renameMock).toHaveBeenCalledWith({
      id: "rep-1",
      organizationId: "org-1",
      name: "New",
    });
  });

  it("scopes a delete to the caller's workspace and echoes the id", async () => {
    deleteMock.mockResolvedValue(undefined);

    const { body } = unwrap(
      await action(post({ intent: "delete-report", reportId: "rep-1" }))
    );

    expect(deleteMock).toHaveBeenCalledWith({
      id: "rep-1",
      organizationId: "org-1",
    });
    expect(body.deleted).toBe("rep-1");
  });

  it("returns the service's status for a duplicate name", async () => {
    createMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Taken",
        status: 409,
        label: "Report",
      })
    );

    const { status, body } = unwrap(
      await action(
        post({ intent: "save-report", name: "Taken", query: "dataset=assets" })
      )
    );

    expect(status).toBe(409);
    expect((body.error as { message: string }).message).toBe("Taken");
  });

  it("rejects an empty name with a validation error", async () => {
    const { status } = unwrap(
      await action(
        post({ intent: "save-report", name: "   ", query: "dataset=assets" })
      )
    );

    expect(status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    const { status } = unwrap(await action(post({ intent: "star-report" })));

    expect(status).toBe(400);
    expect(requirePermissionMock).not.toHaveBeenCalled();
  });
});
