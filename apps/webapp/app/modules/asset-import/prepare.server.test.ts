// @vitest-environment node
/**
 * Tests for the PREPARE step: the import moves to RUNNING, the file's QR
 * codes are claimed, every name is resolved to an id and stored, and running
 * the step twice stores the same maps. Also covers the permission re-check.
 *
 * @see {@link file://./prepare.server.ts}
 */
import type { AssetImport } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { createAssetModelsIfNotExists } from "~/modules/asset-model/service.server";
import { createCategoriesIfNotExists } from "~/modules/category/service.server";
import { createCustomFieldsIfNotExists } from "~/modules/custom-field/service.server";
import { createKitsIfNotExists } from "~/modules/kit/service.server";
import { createLocationsIfNotExists } from "~/modules/location/service.server";
import { claimImportQrCodes } from "~/modules/qr/service.server";
import { createTagsIfNotExists } from "~/modules/tag/service.server";
import { createTeamMemberIfNotExists } from "~/modules/team-member/service.server";
import { runPrepareStep, userCanStillImport } from "./prepare.server";
import type { StoredImportRow } from "./types";

// why: the import row and the membership live in the database.
vi.mock("~/database/db.server", () => ({
  db: {
    assetImport: { updateMany: vi.fn() },
    userOrganization: { findFirst: vi.fn() },
  },
}));

// why: claiming QR codes is a database write with its own tests.
vi.mock("~/modules/qr/service.server", () => ({ claimImportQrCodes: vi.fn() }));

// why: the find-or-create helpers write to the database and have their own
// tests; here only what PREPARE does with their results matters.
vi.mock("~/modules/kit/service.server", () => ({
  createKitsIfNotExists: vi.fn(),
}));
vi.mock("~/modules/category/service.server", () => ({
  createCategoriesIfNotExists: vi.fn(),
}));
vi.mock("~/modules/location/service.server", () => ({
  createLocationsIfNotExists: vi.fn(),
}));
vi.mock("~/modules/team-member/service.server", () => ({
  createTeamMemberIfNotExists: vi.fn(),
}));
vi.mock("~/modules/tag/service.server", () => ({
  createTagsIfNotExists: vi.fn(),
}));
vi.mock("~/modules/custom-field/service.server", () => ({
  createCustomFieldsIfNotExists: vi.fn(),
}));
vi.mock("~/modules/asset-model/service.server", () => ({
  createAssetModelsIfNotExists: vi.fn(),
}));

const rows: StoredImportRow[] = [
  {
    key: "k1",
    title: "Camera",
    assetId: "a1",
    rowNumber: 2,
    qrId: "qr-1",
    kit: "Camera kit",
    custodian: "Sam",
    category: "Tools",
  },
  { key: "k2", title: "Tripod", assetId: "a2", rowNumber: 3 },
];

/**
 * A QUEUED import holding the rows above.
 *
 * @param overrides - Fields to set
 */
function imp(overrides: Partial<AssetImport> = {}): AssetImport {
  return {
    id: "imp",
    status: "QUEUED",
    phase: "PREPARE",
    totalRows: 2,
    processedRows: 0,
    rows,
    resolved: null,
    startedAt: null,
    createdById: "u",
    organizationId: "org",
    ...overrides,
  } as AssetImport;
}

const expectedResolved = {
  kits: { "Camera kit": "kit-1" },
  categories: { Tools: "cat-1" },
  locations: {},
  teamMembers: { Sam: "tm-1" },
  tags: {},
  customFields: { Serial: "cf-1" },
  assetModels: {},
  qrIdsByRowKey: { k1: "qr-1" },
};

describe("runPrepareStep", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.assetImport.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(createKitsIfNotExists).mockResolvedValue({
      "Camera kit": { id: "kit-1", name: "Camera kit" },
    } as never);
    vi.mocked(createCategoriesIfNotExists).mockResolvedValue({
      Tools: "cat-1",
    });
    vi.mocked(createLocationsIfNotExists).mockResolvedValue({});
    vi.mocked(createTeamMemberIfNotExists).mockResolvedValue({
      Sam: { id: "tm-1", name: "Sam" },
    } as never);
    vi.mocked(createTagsIfNotExists).mockResolvedValue({});
    vi.mocked(createCustomFieldsIfNotExists).mockResolvedValue({
      customFields: { Serial: { id: "cf-1", name: "Serial" } },
      newOrUpdatedFields: [],
    } as never);
    vi.mocked(createAssetModelsIfNotExists).mockResolvedValue({});
  });

  it("marks the import RUNNING with its first start time", async () => {
    await runPrepareStep(imp());

    expect(db.assetImport.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "imp",
        organizationId: "org",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        status: "RUNNING",
        phase: "PREPARE",
        startedAt: expect.any(Date),
      },
    });
  });

  it("keeps the first start time of a resumed import", async () => {
    await runPrepareStep(imp({ startedAt: new Date("2026-01-01") }));

    const firstCall = vi.mocked(db.assetImport.updateMany).mock.calls[0][0];
    expect(firstCall?.data).not.toHaveProperty("startedAt");
  });

  it("claims the QR codes the rows carry", async () => {
    await runPrepareStep(imp());

    expect(claimImportQrCodes).toHaveBeenCalledWith({
      qrIds: ["qr-1"],
      organizationId: "org",
      userId: "u",
    });
  });

  it("stores every map as ids and moves to ROWS", async () => {
    await runPrepareStep(imp());

    expect(db.assetImport.updateMany).toHaveBeenLastCalledWith({
      where: { id: "imp", organizationId: "org", status: "RUNNING" },
      data: { resolved: expectedResolved, phase: "ROWS" },
    });
  });

  it("returns the first chunk for a new import", async () => {
    await expect(runPrepareStep(imp())).resolves.toEqual({
      importId: "imp",
      step: "ROWS",
      chunkIndex: 0,
    });
  });

  it("continues a resumed import at the chunk holding the first unwritten row", async () => {
    await expect(
      runPrepareStep(imp({ totalRows: 350, processedRows: 200 }))
    ).resolves.toEqual({ importId: "imp", step: "ROWS", chunkIndex: 2 });
  });

  it("goes straight to FINALIZE when every row is already written", async () => {
    await expect(
      runPrepareStep(imp({ totalRows: 2, processedRows: 2 }))
    ).resolves.toEqual({ importId: "imp", step: "FINALIZE" });
  });

  it("is harmless to run twice: the second run stores the same maps", async () => {
    await runPrepareStep(imp());
    await runPrepareStep(imp({ status: "RUNNING" }));

    const resolvedWrites = vi
      .mocked(db.assetImport.updateMany)
      .mock.calls.map(([args]) => args?.data)
      .filter((data) => data && "resolved" in data);
    expect(resolvedWrites).toHaveLength(2);
    expect(resolvedWrites[0]).toEqual(resolvedWrites[1]);
  });

  it("stops without resolving anything when the import is no longer active", async () => {
    vi.mocked(db.assetImport.updateMany).mockResolvedValueOnce({ count: 0 });

    await expect(runPrepareStep(imp())).resolves.toBeNull();
    expect(claimImportQrCodes).not.toHaveBeenCalled();
    expect(createKitsIfNotExists).not.toHaveBeenCalled();
  });
});

describe("userCanStillImport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("allows an administrator", async () => {
    vi.mocked(db.userOrganization.findFirst).mockResolvedValue({
      roles: ["ADMIN"],
    } as never);

    await expect(
      userCanStillImport({ userId: "u", organizationId: "org" })
    ).resolves.toBe(true);
  });

  it("refuses a role without asset import", async () => {
    vi.mocked(db.userOrganization.findFirst).mockResolvedValue({
      roles: ["BASE"],
    } as never);

    await expect(
      userCanStillImport({ userId: "u", organizationId: "org" })
    ).resolves.toBe(false);
  });

  it("refuses a user who left the workspace", async () => {
    vi.mocked(db.userOrganization.findFirst).mockResolvedValue(null);

    await expect(
      userCanStillImport({ userId: "u", organizationId: "org" })
    ).resolves.toBe(false);
  });
});
