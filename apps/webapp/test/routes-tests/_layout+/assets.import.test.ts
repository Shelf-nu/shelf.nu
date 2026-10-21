// @vitest-environment node
/**
 * Asset import upload and confirm action.
 *
 * Pins the `analyze`, `preview` and `confirm` intents: the column mapping
 * proposal and its refusals, the reviewed mapping applied before the preview,
 * the funnel events, the permission gate, the preview
 * payload, the empty-file errors (shown on the page, never as a toast), the
 * redirect to the progress page, and that a draft from another workspace is
 * never confirmed. The loader is pinned for the running import it hands the
 * page, which holds the upload form. The real import service runs against a mocked
 * database so the workspace scoping is exercised, not assumed.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets.import.tsx}
 * @see {@link file://./../../../app/modules/asset-import/service.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import { isAlreadyShelfFormat } from "~/modules/import-mapping/heuristics";
import type {
  ColumnMapping,
  MappingProposal,
} from "~/modules/import-mapping/types";
import { buildContentImportPreview } from "~/modules/asset-import/preview.server";
import { action, loader } from "~/routes/_layout+/assets.import";
import { csvDataFromRequest } from "~/utils/csv.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: authorization is not under test; what it is called with and what it
// answers per case is.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: subscription limits are a separate concern from the import routes.
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanImportAssets: vi.fn(),
}));

// why: the route parses an uploaded file; rows are driven in directly.
vi.mock("~/utils/csv.server", () => ({ csvDataFromRequest: vi.fn() }));

// why: the preview reads the workspace and writes the draft; it has its own
// suite, here only how the route calls it matters.
vi.mock("~/modules/asset-import/preview.server", () => ({
  buildContentImportPreview: vi.fn(),
}));

// why: the import rows, and the custom fields, categories and locations the
// mapping step reads, live in the database.
vi.mock("~/database/db.server", () => ({
  db: {
    assetImport: { findFirst: vi.fn(), updateMany: vi.fn() },
    customField: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
    location: { findMany: vi.fn() },
  },
}));

// why: analytics goes to PostHog over the network; tests assert what is sent.
vi.mock("~/integrations/posthog/client.server", () => ({
  captureServerEvent: vi.fn(),
}));

// why: the queue has its own tests; confirm only has to reach it.
vi.mock("~/modules/asset-import/worker.server", () => ({
  enqueueAssetImportStep: vi.fn(),
}));

// why: validation has its own suite.
vi.mock("~/modules/asset-import/validate.server", () => ({
  validateContentImportFile: vi.fn(),
}));

// why: the failure helper sends email over the network.
vi.mock("~/emails/asset-import-finished", () => ({
  sendAssetImportFinishedEmail: vi.fn(),
}));

// why: toasts travel over server-sent events; only whether one is sent matters.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

type ActionResult = { init?: { status?: number }; data?: unknown };

/** Runs the action with a body and returns what it returned. */
async function run(body: BodyInit, headers?: HeadersInit) {
  return (await action(
    createActionArgs({
      request: new Request("http://localhost/assets/import", {
        method: "POST",
        body,
        headers,
      }),
      params: {},
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  )) as unknown;
}

describe("assets.import action", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      ...permissionContext({}),
      organizations: [],
      canUseBarcodes: true,
    } as never);
  });

  it("returns the preview for an uploaded file", async () => {
    const preview = { importId: "imp-1", totalRows: 1 };
    vi.mocked(csvDataFromRequest).mockResolvedValue([["title"], ["Drill"]]);
    vi.mocked(buildContentImportPreview).mockResolvedValue(preview as never);
    const form = new FormData();
    form.set("intent", "preview");
    form.set("file", new File(["title\nDrill"], "assets.csv"));

    const result = (await run(form)) as { intent: string; preview: unknown };

    expect(result).toMatchObject({ intent: "preview", preview });
    expect(buildContentImportPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "assets.csv",
        userId: "user-1",
        canUseBarcodes: true,
      })
    );
  });

  it("refuses an empty file without a toast", async () => {
    vi.mocked(csvDataFromRequest).mockResolvedValue([]);

    const result = (await run(
      new URLSearchParams({ intent: "preview" })
    )) as ActionResult;

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({
      error: { message: "This file is empty." },
    });
    expect(buildContentImportPreview).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("refuses a file with headers but no assets", async () => {
    vi.mocked(csvDataFromRequest).mockResolvedValue([["title"]]);

    const result = (await run(
      new URLSearchParams({ intent: "preview" })
    )) as ActionResult;

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({
      error: {
        title: "No assets in file",
        message:
          "This file has headers but no assets. Add at least one row below the headers.",
      },
    });
    expect(buildContentImportPreview).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("queues a confirmed draft and redirects to its progress page", async () => {
    vi.mocked(db.assetImport.findFirst)
      .mockResolvedValueOnce({
        id: "imp-1",
        status: "DRAFT",
        rows: [],
        canUseBarcodes: false,
        createdAt: new Date(),
      } as never)
      .mockResolvedValueOnce(null);
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });

    const result = (await run(
      new URLSearchParams({ intent: "confirm", importId: "imp-1" })
    )) as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/assets/import/imp-1");
    // The job follows the workspace's barcode add-on at confirm time, not the
    // one stored with the draft.
    expect(db.assetImport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "QUEUED",
          canUseBarcodes: true,
        }),
      })
    );
  });

  it("404s on a draft that belongs to another workspace", async () => {
    // The draft lookup is scoped to the active workspace, so a foreign draft
    // is simply not found.
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

    const result = (await run(
      new URLSearchParams({ intent: "confirm", importId: "foreign" })
    )) as ActionResult;

    expect(result.init?.status).toBe(404);
    expect(db.assetImport.findFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign",
        organizationId: "org-1",
        createdById: "user-1",
      },
    });
    expect(db.assetImport.updateMany).not.toHaveBeenCalled();
  });

  it.each(["preview", "confirm"])(
    "403s %s without asset: import",
    async (intent) => {
      vi.mocked(requirePermission).mockRejectedValue(
        new ShelfError({
          cause: null,
          message: "Forbidden",
          label: "Permission",
          status: 403,
          shouldBeCaptured: false,
        })
      );

      const result = (await run(
        new URLSearchParams({ intent, importId: "imp-1" })
      )) as ActionResult;

      expect(result.init?.status).toBe(403);
      expect(buildContentImportPreview).not.toHaveBeenCalled();
      expect(db.assetImport.updateMany).not.toHaveBeenCalled();
    }
  );
});

/** An `AssetImport` status row as the active import lookup selects it. */
function importRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "imp-9",
    organizationId: "org-1",
    createdById: "user-2",
    status: "RUNNING",
    phase: "ROWS",
    fileName: "assets.csv",
    totalRows: 3000,
    processedRows: 900,
    errorMessage: null,
    warningCount: 0,
    completedAt: null,
    // Fresh, so the stall check leaves it alone.
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Runs the loader as user-1. */
async function load() {
  return (await loader(
    createLoaderArgs({
      request: new Request("http://localhost/assets/import"),
      params: {},
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  )) as { runningImport: unknown };
}

describe("assets.import loader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      ...permissionContext({}),
      organizations: [],
      canUseBarcodes: true,
    } as never);
  });

  it("returns the workspace's running import", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(importRow() as never);

    const result = await load();

    expect(result.runningImport).toMatchObject({
      id: "imp-9",
      status: "RUNNING",
      processedRows: 900,
      totalRows: 3000,
      isMine: false,
    });
    expect(db.assetImport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1" }),
      })
    );
  });

  it("does not hold the form for the viewer's finished import", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(
      importRow({
        createdById: "user-1",
        status: "COMPLETED",
        phase: "FINALIZE",
        processedRows: 3000,
        completedAt: new Date(),
      }) as never
    );

    const result = await load();

    expect(result.runningImport).toBeNull();
  });

  it("returns null when nothing is running", async () => {
    vi.mocked(db.assetImport.findFirst).mockResolvedValue(null);

    const result = await load();

    expect(result.runningImport).toBeNull();
  });
});

describe("assets.import column mapping", () => {
  const MESSY_FILE: [string[], ...string[][]] = [
    ["Item Name", "Serial No.", "Legacy ID"],
    ["Dell Latitude", "5CG31", "X-1"],
    ["HP EliteBook", "8HQ22", "X-2"],
  ];

  /** The mapping the review would post for MESSY_FILE. */
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

  /** Posts the import form with these fields. */
  function post(fields: Record<string, string>) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("file", new File(["x"], "assets.csv"));
    return run(form);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      ...permissionContext({}),
      organizations: [],
      canUseBarcodes: false,
    } as never);
    vi.mocked(csvDataFromRequest).mockResolvedValue(MESSY_FILE);
    vi.mocked(db.customField.findMany).mockResolvedValue([
      { name: "Serial number", type: "TEXT" },
    ] as never);
    vi.mocked(buildContentImportPreview).mockResolvedValue({
      importId: "imp-1",
    } as never);
  });

  describe("analyze", () => {
    it("proposes a mapping by rules and stores nothing", async () => {
      const result = (await post({ intent: "analyze" })) as Record<
        string,
        unknown
      >;

      expect(buildContentImportPreview).not.toHaveBeenCalled();
      // New categories and locations are named once, by the preview.
      expect(db.category.findMany).not.toHaveBeenCalled();
      expect(db.location.findMany).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("columnStats");
      expect(db.customField.findMany).toHaveBeenCalledWith({
        where: { organizationId: "org-1", deletedAt: null },
        select: { name: true, type: true },
      });
      expect(result).toMatchObject({
        intent: "analyze",
        rowCount: 2,
        existingCustomFields: [{ name: "Serial number", type: "TEXT" }],
        proposal: {
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
        },
      });
      expect(captureServerEvent).toHaveBeenCalledWith({
        distinctId: "user-1",
        event: "import_mapping_proposed",
        properties: { organizationId: "org-1", columns: 3, lowConfidence: 1 },
      });
    });

    it("proposes a template file as already in Shelf's format", async () => {
      vi.mocked(csvDataFromRequest).mockResolvedValue([
        ["title", "category"],
        ["Camera", "Video"],
      ]);
      const result = (await post({ intent: "analyze" })) as {
        proposal: MappingProposal;
      };
      // The review reads "already matches" off the proposal it is sent.
      expect(isAlreadyShelfFormat(result.proposal.columns)).toBe(true);
    });

    it("refuses a file over the background import's row limit before any review", async () => {
      vi.mocked(csvDataFromRequest).mockResolvedValue([
        ["Item Name"],
        ...Array.from({ length: 10_001 }, (_, index) => [`Item ${index}`]),
      ]);
      const result = (await post({ intent: "analyze" })) as ActionResult;

      expect(result.init?.status).toBe(400);
      expect(result.data).toMatchObject({ error: { title: "File too large" } });
      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "import_failed",
          properties: { organizationId: "org-1", reason: "too_many_rows" },
        })
      );
    });

    it("refuses a heading longer than the importer can carry", async () => {
      vi.mocked(csvDataFromRequest).mockResolvedValue([
        ["Item Name", "H".repeat(1001)],
        ["A", "x"],
      ]);
      const result = (await post({ intent: "analyze" })) as ActionResult;
      expect(result.data).toMatchObject({
        error: { title: "Column heading too long" },
      });
    });

    it("refuses more columns than the review can show", async () => {
      vi.mocked(csvDataFromRequest).mockResolvedValue([
        Array.from({ length: 201 }, (_, index) => `Col ${index}`),
        ["x"],
      ]);
      const result = (await post({ intent: "analyze" })) as ActionResult;
      expect(result.data).toMatchObject({
        error: { title: "Too many columns" },
      });
    });
  });

  describe("preview with a reviewed mapping", () => {
    it("renames headers and drops skipped columns before the preview", async () => {
      await post({
        intent: "preview",
        mapping: JSON.stringify(MAPPING),
        mappingChanged: "1",
        mappingNewCustomFields: "0",
      });

      expect(buildContentImportPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          csvData: [
            ["title", "cf:Serial number, type:text"],
            ["Dell Latitude", "5CG31"],
            ["HP EliteBook", "8HQ22"],
          ],
        })
      );
      expect(captureServerEvent).toHaveBeenCalledWith({
        distinctId: "user-1",
        event: "import_mapping_confirmed",
        properties: {
          organizationId: "org-1",
          columns: 3,
          changedByUser: 1,
          newCustomFields: 0,
        },
      });
    });

    it("tracks every row as stock when the user chose a consumption type", async () => {
      vi.mocked(csvDataFromRequest).mockResolvedValue([
        ["Entry Name", "Quantity"],
        ["Cable", "10"],
      ]);
      await post({
        intent: "preview",
        mapping: JSON.stringify([
          { ...MAPPING[0], source: "Entry Name" },
          {
            source: "Quantity",
            target: { kind: "field", name: "quantity" },
            confidence: "high",
            sample: [],
          },
        ]),
        quantityTracking: "ONE_WAY",
      });

      expect(buildContentImportPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          csvData: [
            ["title", "quantity", "type", "consumptionType"],
            ["Cable", "10", "QUANTITY_TRACKED", "ONE_WAY"],
          ],
        })
      );
    });

    it("refuses a quantity choice that is not one of the options", async () => {
      const result = (await post({
        intent: "preview",
        mapping: JSON.stringify(MAPPING),
        quantityTracking: "SOMETIMES",
      })) as ActionResult;
      expect(result.init?.status).toBe(400);
      expect(buildContentImportPreview).not.toHaveBeenCalled();
    });

    it("reports the mapping as confirmed only once the preview is built", async () => {
      vi.mocked(buildContentImportPreview).mockRejectedValue(
        new ShelfError({
          cause: null,
          message: "Row 2: title is required",
          label: "Assets",
          status: 400,
          shouldBeCaptured: false,
        })
      );
      await post({ intent: "preview", mapping: JSON.stringify(MAPPING) });

      expect(captureServerEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: "import_mapping_confirmed" })
      );
    });

    it("previews the file unchanged when no mapping is posted", async () => {
      await post({ intent: "preview" });
      expect(buildContentImportPreview).toHaveBeenCalledWith(
        expect.objectContaining({ csvData: MESSY_FILE })
      );
      expect(captureServerEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: "import_mapping_confirmed" })
      );
    });

    it("accepts a long heading under the limit all the way to the preview", async () => {
      const long = "H".repeat(900);
      vi.mocked(csvDataFromRequest).mockResolvedValue([
        ["Item Name", long],
        ["A", "x"],
      ]);
      await post({
        intent: "preview",
        mapping: JSON.stringify([MAPPING[0], { ...MAPPING[2], source: long }]),
      });
      expect(buildContentImportPreview).toHaveBeenCalled();
    });

    it.each([
      [
        "two columns on one target",
        () =>
          JSON.stringify(
            MAPPING.map((column) =>
              column.source === "Legacy ID"
                ? { ...column, target: { kind: "field", name: "title" } }
                : column
            )
          ),
        "Two columns share one Shelf field",
        "duplicate_targets",
      ],
      [
        "reordered columns",
        () => JSON.stringify([MAPPING[1], MAPPING[0], MAPPING[2]]),
        "Mapping does not match the file",
        "invalid_mapping",
      ],
      [
        "a header the importer does not take",
        () =>
          JSON.stringify(
            MAPPING.map((column, index) =>
              index === 2
                ? { ...column, target: { kind: "field", name: "id" } }
                : column
            )
          ),
        "Invalid column mapping",
        "invalid_mapping",
      ],
      [
        "invalid JSON",
        () => "{not json",
        "Invalid column mapping",
        "invalid_mapping",
      ],
    ])("refuses %s", async (_name, mapping, title, reason) => {
      const result = (await post({
        intent: "preview",
        mapping: mapping(),
      })) as ActionResult;

      expect(buildContentImportPreview).not.toHaveBeenCalled();
      expect(result.init?.status).toBe(400);
      expect(result.data).toMatchObject({ error: { title } });
      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "import_failed",
          properties: { organizationId: "org-1", reason },
        })
      );
    });

    it("refuses a mapping field larger than any real file needs", async () => {
      const result = (await post({
        intent: "preview",
        mapping: "x".repeat(300_000),
      })) as ActionResult;
      expect(buildContentImportPreview).not.toHaveBeenCalled();
      expect(result.data).toMatchObject({ error: expect.anything() });
    });
  });

  it("reports nothing when the member may not import", async () => {
    vi.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "No access",
        label: "Permission",
        status: 403,
      })
    );
    await post({ intent: "analyze" });
    expect(captureServerEvent).not.toHaveBeenCalled();
  });
});
