/**
 * Asset import route: the `analyze` intent (propose a column mapping) and the
 * `content` intent with and without a reviewed mapping.
 *
 * The importer itself is mocked: these tests assert which rows it is handed.
 * The mapping modules run for real.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.import.tsx}
 * @see {@link file://./../../../app/modules/import-mapping/propose.ts}
 */
import { createCustomField } from "@factories";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/assets.import";

// why: the route's component tree imports lottie, which draws on a canvas at
// import time; happy-dom has no canvas.
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

// why: existing custom fields are read through Prisma; each test sets them.
vi.mock("~/database/db.server", () => ({
  db: {
    customField: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
  },
}));

// why: requirePermission reads the caller's membership from the database.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the tier check reads the workspace's subscription from the database.
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanImportAssets: vi.fn(),
}));

// why: the uploaded file arrives as multipart form data, which happy-dom does
// not round-trip; the parsed rows are what the route works with.
vi.mock("~/utils/csv.server", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("~/utils/csv.server")),
  csvDataFromRequest: vi.fn(),
}));

// why: the import itself writes assets; these tests assert what it is asked to do.
vi.mock("~/modules/asset/service.server", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "~/modules/asset/service.server"
  )),
  createAssetsFromContentImport: vi.fn(),
}));

// why: analytics goes to PostHog over the network; tests assert what is sent.
vi.mock("~/integrations/posthog/client.server", () => ({
  captureServerEvent: vi.fn(),
}));

import { db } from "~/database/db.server";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import { createAssetsFromContentImport } from "~/modules/asset/service.server";
import type { ColumnMapping } from "~/modules/import-mapping/types";
import { csvDataFromRequest } from "~/utils/csv.server";
import { requirePermission } from "~/utils/roles.server";

const USER_ID = "user-1";
const ORG_ID = "org-1";

const MESSY_FILE: [string[], ...string[][]] = [
  ["Item Name", "Serial No.", "Legacy ID"],
  ["Dell Latitude", "5CG31", "X-1"],
  ["HP EliteBook", "8HQ22", "X-2"],
];

/** Builds action args posting the import form. */
function importArgs(fields: Record<string, string>) {
  return {
    request: new Request("http://localhost/assets/import", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: { getSession: () => ({ userId: USER_ID }) },
  } as unknown as Parameters<typeof action>[0];
}

/** Reads the JSON body of a `data()` response or plain payload. */
function body(result: unknown) {
  const value = result as { data?: unknown };
  return (value && "data" in value ? value.data : value) as Record<
    string,
    unknown
  >;
}

/** The mapping the review step would post for MESSY_FILE. */
const MAPPING: ColumnMapping[] = [
  {
    source: "Item Name",
    target: { kind: "field", name: "title" },
    confidence: "high",
    sample: [],
  },
  {
    source: "Serial No.",
    target: { kind: "customField", name: "Serial number", type: "TEXT" },
    confidence: "high",
    sample: [],
  },
  {
    source: "Legacy ID",
    target: { kind: "skip" },
    confidence: "low",
    sample: [],
  },
];

describe("assets import route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: ORG_ID,
      organizations: [],
      canUseBarcodes: false,
    } as never);
    vi.mocked(csvDataFromRequest).mockResolvedValue(MESSY_FILE);
    vi.mocked(db.customField.findMany).mockResolvedValue([
      createCustomField({ name: "Serial number", type: "TEXT" }),
    ]);
    vi.mocked(createAssetsFromContentImport).mockResolvedValue(true as never);
    vi.mocked(db.category.findMany).mockResolvedValue([]);
    vi.mocked(db.location.findMany).mockResolvedValue([]);
  });

  describe("analyze", () => {
    it("returns a rules proposal and imports nothing", async () => {
      const result = body(await action(importArgs({ intent: "analyze" })));

      expect(createAssetsFromContentImport).not.toHaveBeenCalled();
      expect(db.customField.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID, deletedAt: null },
        select: { name: true, type: true },
      });
      expect(result.rowCount).toBe(2);
      expect(result.existingCustomFields).toEqual([
        expect.objectContaining({ name: "Serial number", type: "TEXT" }),
      ]);
      expect(result.columnStats).toEqual([
        { newCategories: 2, newLocations: 2 },
        { newCategories: 2, newLocations: 2 },
        { newCategories: 2, newLocations: 2 },
      ]);
      expect(result.alreadyMatches).toBe(false);
      expect(result.proposal).toMatchObject({
        source: "rules",
        columns: [
          { source: "Item Name", target: { kind: "field", name: "title" } },
          {
            source: "Serial No.",
            target: {
              kind: "customField",
              name: "Serial number",
              type: "TEXT",
            },
          },
          { source: "Legacy ID", target: { kind: "skip" } },
        ],
      });
    });

    it("says when the file already matches Shelf's format", async () => {
      vi.mocked(csvDataFromRequest).mockResolvedValue([
        ["title", "category"],
        ["Camera", "Video"],
      ]);
      const result = body(await action(importArgs({ intent: "analyze" })));
      expect(result.alreadyMatches).toBe(true);
    });
  });

  describe("analytics", () => {
    it("reports the proposal as counts only", async () => {
      await action(importArgs({ intent: "analyze" }));
      expect(captureServerEvent).toHaveBeenCalledWith({
        distinctId: USER_ID,
        event: "import_mapping_proposed",
        properties: {
          organizationId: ORG_ID,
          columns: 3,
          lowConfidence: 1,
        },
      });
    });

    it("reports the confirmed mapping and the finished import", async () => {
      const withNewField = MAPPING.map((column) =>
        column.source === "Legacy ID"
          ? {
              ...column,
              target: {
                kind: "customField" as const,
                name: "Legacy id",
                type: "TEXT" as const,
              },
            }
          : column
      );
      await action(
        importArgs({
          intent: "content",
          mapping: JSON.stringify(withNewField),
          mappingChanged: "1",
        })
      );

      expect(captureServerEvent).toHaveBeenCalledWith({
        distinctId: USER_ID,
        event: "import_mapping_confirmed",
        properties: {
          organizationId: ORG_ID,
          columns: 3,
          changedByUser: 1,
          newCustomFields: 1,
        },
      });
      expect(captureServerEvent).toHaveBeenCalledWith({
        distinctId: USER_ID,
        event: "import_completed",
        properties: { organizationId: ORG_ID, rows: 2 },
      });
    });

    it("reports a refused import with its reason only", async () => {
      await action(importArgs({ intent: "content" }));
      expect(captureServerEvent).toHaveBeenCalledWith({
        distinctId: USER_ID,
        event: "import_failed",
        properties: { organizationId: ORG_ID, reason: "invalid_headers" },
      });
    });

    it("reports a clashing mapping as duplicate_targets", async () => {
      const clash = MAPPING.map((column) =>
        column.source === "Legacy ID"
          ? {
              ...column,
              target: { kind: "field" as const, name: "title" as const },
            }
          : column
      );
      await action(
        importArgs({ intent: "content", mapping: JSON.stringify(clash) })
      );
      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "import_failed",
          properties: { organizationId: ORG_ID, reason: "duplicate_targets" },
        })
      );
    });

    it("reports nothing when the member may not import", async () => {
      vi.mocked(requirePermission).mockRejectedValue(new Error("forbidden"));
      await action(importArgs({ intent: "content" }));
      expect(captureServerEvent).not.toHaveBeenCalled();
    });

    it("reports a plain import without a mapping event", async () => {
      vi.mocked(csvDataFromRequest).mockResolvedValue([["title"], ["Camera"]]);
      await action(importArgs({ intent: "content" }));
      expect(captureServerEvent).toHaveBeenCalledTimes(1);
      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "import_completed",
          properties: { organizationId: ORG_ID, rows: 1 },
        })
      );
    });
  });

  describe("content", () => {
    it("renames headers and drops skipped columns before importing", async () => {
      await action(
        importArgs({ intent: "content", mapping: JSON.stringify(MAPPING) })
      );

      const { data } = vi.mocked(createAssetsFromContentImport).mock
        .calls[0][0];
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        title: "Dell Latitude",
        "cf:Serial number, type:text": "5CG31",
      });
      expect(data[0]).not.toHaveProperty("Legacy ID");
    });

    it("imports the file unchanged when no mapping is posted", async () => {
      vi.mocked(csvDataFromRequest).mockResolvedValue([
        ["title", "category"],
        ["Camera", "Video"],
      ]);
      await action(importArgs({ intent: "content" }));

      const { data } = vi.mocked(createAssetsFromContentImport).mock
        .calls[0][0];
      expect(data[0]).toMatchObject({ title: "Camera", category: "Video" });
    });

    it("keeps refusing unknown headers when no mapping is posted", async () => {
      const result = await action(importArgs({ intent: "content" }));

      expect(createAssetsFromContentImport).not.toHaveBeenCalled();
      expect(body(result).error).toMatchObject({
        additionalData: {
          defectedHeaders: expect.arrayContaining([
            expect.objectContaining({ incorrectHeader: "Item Name" }),
          ]),
        },
      });
    });

    it("rejects a mapping with two columns on one target", async () => {
      const clash = MAPPING.map((column) =>
        column.source === "Legacy ID"
          ? {
              ...column,
              target: { kind: "field" as const, name: "title" as const },
            }
          : column
      );
      const result = await action(
        importArgs({ intent: "content", mapping: JSON.stringify(clash) })
      );

      expect(createAssetsFromContentImport).not.toHaveBeenCalled();
      expect(body(result).error).toMatchObject({
        title: "Two columns share one Shelf field",
      });
    });

    it("rejects a mapping that is not valid JSON", async () => {
      const result = await action(
        importArgs({ intent: "content", mapping: "{not json" })
      );

      expect(createAssetsFromContentImport).not.toHaveBeenCalled();
      expect(body(result).error).toMatchObject({
        title: "Invalid column mapping",
      });
    });
  });
});
