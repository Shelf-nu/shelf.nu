/**
 * Route tests for the dedicated audit creation page, `/audits/new`.
 *
 * Pins the action's contract: an explicit selection reaches `startAudit`
 * untouched and redirects to the new audit's overview, "select all" is
 * expanded with the list's own query, a workspace without the add-on is
 * refused before anything is created, and an empty selection is a field
 * error rather than a crash.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.new.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action, loader } from "~/routes/_layout+/audits.new";
import { ALL_SELECTED_KEY } from "~/utils/list";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  canUseAudits: vi.fn(),
  startAudit: vi.fn(),
  getAssetListWhereForSelectAll: vi.fn(),
  getPaginatedAndFilterableAssets: vi.fn(),
  assetFindMany: vi.fn(),
}));

// why: the route gates on permission; grant it without hitting auth or the DB.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mocks.requirePermission,
}));

// why: the add-on gate reads an environment flag; control it per case.
vi.mock("~/utils/subscription.server", () => ({
  canUseAudits: mocks.canUseAudits,
}));

// why: audit creation, emails and reminder jobs are the shared helper's job
// and covered by its own tests; here only what the route hands it matters.
vi.mock("~/modules/audit/start-audit.server", () => ({
  startAudit: mocks.startAudit,
}));

// why: the select-all expansion runs the asset list query; assert its inputs
// instead of standing up a database.
vi.mock("~/modules/asset/list-where.server", () => ({
  getAssetListWhereForSelectAll: mocks.getAssetListWhereForSelectAll,
}));

// why: the loader's asset list comes from the database.
vi.mock("~/modules/asset/service.server", () => ({
  getPaginatedAndFilterableAssets: mocks.getPaginatedAndFilterableAssets,
}));

// why: the route imports the global Prisma client at module load.
vi.mock("~/database/db.server", () => ({
  db: { asset: { findMany: mocks.assetFindMany } },
}));

// why: the timezone preference lookup is a DB read the helper mock never triggers.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
}));

/** Builds a POST to `/audits/new` carrying the given fields. */
function buildPost(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  const request = new Request("https://app.shelf.nu/audits/new", {
    method: "POST",
    headers: { cookie: "" },
    body: formData,
  });
  const context = { getSession: () => ({ userId: "user-1" }) };
  return { request, context, params: {} } as unknown as Parameters<
    typeof action
  >[0];
}

describe("/audits/new", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: { id: "org-1", auditsEnabled: true },
    });
    mocks.canUseAudits.mockReturnValue(true);
    mocks.startAudit.mockResolvedValue({
      sessionId: "audit-1",
      isAssignedToOther: false,
    });
  });

  describe("action", () => {
    it("creates the audit from the picked assets and redirects to its overview", async () => {
      const response = await action(
        buildPost({
          name: "Quarterly warehouse audit",
          description: "Shelf A to D",
          dueDate: "2099-07-20T15:48",
          "assetIds[0]": "asset-1",
          "assetIds[1]": "asset-2",
        })
      );

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
      expect((response as Response).headers.get("Location")).toBe(
        "/audits/audit-1/overview"
      );

      expect(mocks.startAudit).toHaveBeenCalledTimes(1);
      expect(mocks.startAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Quarterly warehouse audit",
          description: "Shelf A to D",
          assetIds: ["asset-1", "asset-2"],
          // The raw wall clock, for the helper to parse in the user's zone.
          dueDateString: "2099-07-20T15:48",
          userId: "user-1",
          organizationId: "org-1",
        })
      );
      expect(mocks.getAssetListWhereForSelectAll).not.toHaveBeenCalled();
    });

    it("lands on the overview even when nobody else is assigned", async () => {
      mocks.startAudit.mockResolvedValue({
        sessionId: "audit-2",
        isAssignedToOther: true,
      });

      const response = (await action(
        buildPost({ name: "Audit", "assetIds[0]": "asset-1" })
      )) as Response;

      expect(response.headers.get("Location")).toBe("/audits/audit-2/overview");
    });

    it("expands 'select all' with the list's own search params", async () => {
      mocks.getAssetListWhereForSelectAll.mockResolvedValue({
        organizationId: "org-1",
      });
      mocks.assetFindMany.mockResolvedValue([
        { id: "asset-7" },
        { id: "asset-8" },
      ]);

      await action(
        buildPost({
          name: "Everything in the warehouse",
          "assetIds[0]": ALL_SELECTED_KEY,
          currentSearchParams: "category=cat-1&s=laptop",
        })
      );

      expect(mocks.getAssetListWhereForSelectAll).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          currentSearchParams: "category=cat-1&s=laptop",
          // The picker shows active assets with no custodian filter, so the
          // expansion must too.
          allowedTeamMemberIds: [],
          bookableScope: null,
          honorArchivedView: false,
        })
      );
      expect(mocks.assetFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: "org-1" } })
      );
      expect(mocks.startAudit).toHaveBeenCalledWith(
        expect.objectContaining({ assetIds: ["asset-7", "asset-8"] })
      );
    });

    it("refuses a workspace without the audits add-on before creating anything", async () => {
      mocks.canUseAudits.mockReturnValue(false);

      const response = await action(
        buildPost({ name: "Audit", "assetIds[0]": "asset-1" })
      );

      expect(response).not.toBeInstanceOf(Response);
      const { data: body, init } = response as unknown as {
        data: { error: { message: string } };
        init: { status: number };
      };
      expect(init.status).toBe(403);
      expect(body.error.message).toMatch(/audits add-on/i);
      expect(mocks.startAudit).not.toHaveBeenCalled();
    });

    it("returns a field error when no asset was picked", async () => {
      const response = await action(buildPost({ name: "Audit" }));

      expect(response).not.toBeInstanceOf(Response);
      const { data: body, init } = response as unknown as {
        data: {
          error: {
            additionalData: {
              validationErrors: Record<string, { message: string }>;
            };
          };
        };
        init: { status: number };
      };
      expect(init.status).toBe(400);
      expect(
        body.error.additionalData.validationErrors.assetIds.message
      ).toMatch(/at least one asset/i);
      expect(mocks.startAudit).not.toHaveBeenCalled();
    });

    it("surfaces the helper's due-date refusal as a field error", async () => {
      const { badRequest } = await import("~/utils/error");
      mocks.startAudit.mockRejectedValue(
        badRequest("Due date must be in the future.", {
          additionalData: {
            validationErrors: {
              dueDate: { message: "Due date must be in the future" },
            },
          },
        })
      );

      const response = await action(
        buildPost({
          name: "Audit",
          dueDate: "2000-01-01T10:00",
          "assetIds[0]": "asset-1",
        })
      );

      const { data: body, init } = response as unknown as {
        data: {
          error: {
            additionalData: {
              validationErrors: Record<string, { message: string }>;
            };
          };
        };
        init: { status: number };
      };
      expect(init.status).toBe(400);
      expect(body.error.additionalData.validationErrors.dueDate.message).toBe(
        "Due date must be in the future"
      );
    });
  });

  describe("loader", () => {
    it("lists the workspace's assets for the picker under the page header", async () => {
      mocks.getPaginatedAndFilterableAssets.mockResolvedValue({
        search: null,
        totalAssets: 2,
        perPage: 20,
        page: 1,
        categories: [],
        tags: [],
        assets: [{ id: "asset-1" }, { id: "asset-2" }],
        totalPages: 1,
        totalCategories: 0,
        totalTags: 0,
        locations: [],
        totalLocations: 0,
      });

      const request = new Request("https://app.shelf.nu/audits/new", {
        headers: { cookie: "" },
      });
      const result = (await loader({
        request,
        context: { getSession: () => ({ userId: "user-1" }) },
        params: {},
      } as unknown as Parameters<typeof loader>[0])) as unknown as {
        header: { title: string };
        items: { id: string }[];
        totalItems: number;
      };

      expect(mocks.requirePermission).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "audit", action: "create" })
      );
      expect(result.header.title).toBe("New audit");
      expect(result.items.map((a) => a.id)).toEqual(["asset-1", "asset-2"]);
      expect(result.totalItems).toBe(2);
    });
  });
});
