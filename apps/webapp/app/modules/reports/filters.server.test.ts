/**
 * Report filter resolution: workspace scoping, declared-only narrowing and
 * chip labels.
 *
 * @see {@link file://./filters.server.ts}
 */

import { CustomFieldType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the resolver verifies ids against the database; the tests drive it
// with fixed lookups so the scoping rules, not Prisma, are under test.
vi.mock("~/database/db.server", () => ({
  db: {
    category: { findMany: vi.fn(), count: vi.fn() },
    location: { findMany: vi.fn(), count: vi.fn() },
    assetModel: { findMany: vi.fn(), count: vi.fn() },
    teamMember: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    customField: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { db } from "~/database/db.server";
import {
  loadReportFilterOptions,
  resolveReportFilters,
} from "./filters.server";
import { getReportById } from "./registry";
import type { ReportDefinition } from "./types";

const inventory = getReportById("asset-inventory")!;
const compliance = getReportById("booking-compliance")!;
const kits = getReportById("top-booked-kits")!;

/** A report definition with exactly the given filter types. */
function reportWith(types: ReportDefinition["filters"][number]["type"][]) {
  return {
    ...inventory,
    filters: types.map((type) => ({ type, label: type, multi: true })),
  } satisfies ReportDefinition;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.category.findMany).mockResolvedValue([] as any);
  vi.mocked(db.location.findMany).mockResolvedValue([] as any);
  vi.mocked(db.assetModel.findMany).mockResolvedValue([] as any);
  vi.mocked(db.teamMember.findFirst).mockResolvedValue(null as any);
  vi.mocked(db.customField.findMany).mockResolvedValue([] as any);
});

describe("resolveReportFilters", () => {
  it("runs no lookup and returns an empty predicate when nothing is set", async () => {
    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: new URLSearchParams("timeframe=last_7d&page=2"),
      reportDef: inventory,
    });

    expect(resolved.assetFilter.isEmpty).toBe(true);
    expect(resolved.active).toEqual([]);
    expect(db.category.findMany).not.toHaveBeenCalled();
  });

  it("keeps only ids that exist in the workspace and labels the survivors", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue([
      { id: "cat-1", name: "Cameras" },
    ] as any);
    vi.mocked(db.assetModel.findMany).mockResolvedValue([
      { id: "model-1", name: "Sony A7 IV" },
    ] as any);

    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: new URLSearchParams(
        "category=cat-1&category=cat-other-org&assetModel=model-1&assetModel=model-other-org"
      ),
      reportDef: inventory,
    });

    expect(db.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["cat-1", "cat-other-org"] },
          organizationId: "org-1",
        },
      })
    );
    expect(resolved.params.categoryIds).toEqual(["cat-1"]);
    expect(resolved.params.assetModelIds).toEqual(["model-1"]);
    expect(resolved.assetFilter.where).toEqual({
      AND: [
        { categoryId: { in: ["cat-1"] } },
        { assetModelId: { in: ["model-1"] } },
      ],
    });
    expect(resolved.active).toEqual([
      {
        type: "category",
        param: "category",
        value: "cat-1",
        label: "Category: Cameras",
      },
      {
        type: "asset_model",
        param: "assetModel",
        value: "model-1",
        label: "Model: Sony A7 IV",
      },
    ]);
  });

  it("ignores filter types the report does not declare", async () => {
    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: new URLSearchParams("category=cat-1&cf=f1:yes"),
      reportDef: kits, // declares category and location only
    });

    expect(resolved.params.customFieldValues).toEqual([]);
    expect(db.customField.findMany).not.toHaveBeenCalled();
  });

  it("resolves custom fields by type and drops unsupported or foreign ones", async () => {
    vi.mocked(db.customField.findMany).mockResolvedValue([
      { id: "f-text", name: "Perkins Purchase", type: CustomFieldType.TEXT },
      { id: "f-bool", name: "Insured", type: CustomFieldType.BOOLEAN },
      { id: "f-date", name: "Purchased", type: CustomFieldType.DATE },
    ] as any);

    const params = new URLSearchParams();
    params.append("cf", "f-text:yes");
    params.append("cf", "f-bool:no");
    params.append("cf", "f-date:2026-01-01");
    params.append("cf", "f-foreign:whatever");

    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: params,
      reportDef: inventory,
    });

    expect(resolved.params.customFieldValues).toEqual([
      { customFieldId: "f-text", value: "yes", type: CustomFieldType.TEXT },
      { customFieldId: "f-bool", value: "no", type: CustomFieldType.BOOLEAN },
    ]);
    expect(resolved.active.map((a) => a.label)).toEqual([
      "Perkins Purchase: yes",
      "Insured: No",
    ]);
    expect(resolved.active[1]).toMatchObject({
      param: "cf",
      value: "f-bool:no",
    });
  });

  it("keeps the 'without location' choice without a lookup and labels it", async () => {
    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: new URLSearchParams("location=without-location"),
      reportDef: inventory,
    });

    expect(db.location.findMany).not.toHaveBeenCalled();
    expect(resolved.assetFilter.where).toEqual({
      assetLocations: { none: {} },
    });
    expect(resolved.active[0].label).toBe("Location: Without location");
  });

  it("verifies the custodian in the workspace and reads booking statuses for booking reports", async () => {
    vi.mocked(db.teamMember.findFirst).mockResolvedValue({
      id: "tm-1",
      name: "Sam Stone",
      user: null,
    } as any);

    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: new URLSearchParams(
        "teamMember=tm-1&status=COMPLETE&status=DRAFT&status=AVAILABLE"
      ),
      reportDef: compliance,
    });

    expect(db.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tm-1", organizationId: "org-1" },
      })
    );
    expect(resolved.teamMemberId).toBe("tm-1");
    // Only measurable booking statuses survive; asset statuses are not
    // booking statuses at all.
    expect(resolved.bookingStatuses).toEqual(["COMPLETE"]);
    expect(resolved.assetFilter.where).toEqual({});
    expect(resolved.active.map((a) => a.label)).toEqual([
      "Custodian: Sam Stone",
      "Status: Complete",
    ]);
  });

  it("reads asset statuses for asset reports", async () => {
    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: new URLSearchParams("status=AVAILABLE&status=COMPLETE"),
      reportDef: inventory,
    });

    expect(resolved.bookingStatuses).toEqual([]);
    expect(resolved.assetFilter.where).toEqual({
      status: { in: ["AVAILABLE"] },
    });
    expect(resolved.active[0].label).toBe("Status: Available");
  });
});

describe("loadReportFilterOptions", () => {
  beforeEach(() => {
    vi.mocked(db.category.count).mockResolvedValue(0 as any);
    vi.mocked(db.location.count).mockResolvedValue(0 as any);
    vi.mocked(db.assetModel.count).mockResolvedValue(0 as any);
    vi.mocked(db.teamMember.count).mockResolvedValue(0 as any);
    vi.mocked(db.teamMember.findMany).mockResolvedValue([] as any);
    vi.mocked(db.$queryRaw).mockResolvedValue([] as any);
  });

  it("loads lists only for the filter types the report declares", async () => {
    const options = await loadReportFilterOptions({
      organizationId: "org-1",
      reportDef: reportWith(["category"]),
    });

    expect(db.category.findMany).toHaveBeenCalledTimes(1);
    expect(db.location.findMany).not.toHaveBeenCalled();
    expect(db.customField.findMany).not.toHaveBeenCalled();
    expect(options.statuses).toEqual([]);
  });

  it("offers TEXT, OPTION and BOOLEAN custom fields with their values", async () => {
    vi.mocked(db.customField.findMany).mockResolvedValue([
      { id: "f-text", name: "Fund", type: CustomFieldType.TEXT, options: [] },
      {
        id: "f-opt",
        name: "Colour",
        type: CustomFieldType.OPTION,
        options: ["Red", "Blue"],
      },
      {
        id: "f-bool",
        name: "Insured",
        type: CustomFieldType.BOOLEAN,
        options: [],
      },
      {
        id: "f-num",
        name: "Weight",
        type: CustomFieldType.NUMBER,
        options: [],
      },
    ] as any);
    // The distinct-values query returns the ranked rows for TEXT fields; a
    // row past the limit signals that more values exist.
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { customFieldId: "f-text", value: "Perkins", rowNumber: 1 },
      { customFieldId: "f-text", value: "General", rowNumber: 2 },
      { customFieldId: "f-text", value: "overflow", rowNumber: 201 },
    ] as any);

    const options = await loadReportFilterOptions({
      organizationId: "org-1",
      reportDef: reportWith(["custom_field"]),
    });

    expect(options.customFields).toEqual([
      {
        id: "f-text",
        name: "Fund",
        type: CustomFieldType.TEXT,
        values: ["Perkins", "General"],
        hasMoreValues: true,
      },
      {
        id: "f-opt",
        name: "Colour",
        type: CustomFieldType.OPTION,
        values: ["Red", "Blue"],
        hasMoreValues: false,
      },
      {
        id: "f-bool",
        name: "Insured",
        type: CustomFieldType.BOOLEAN,
        values: ["yes", "no"],
        hasMoreValues: false,
      },
    ]);
    // Distinct values are read only for TEXT fields, scoped by workspace.
    const rawSql = (
      vi.mocked(db.$queryRaw).mock.calls[0]?.[0] as { sql: string }
    ).sql;
    expect(rawSql).toContain('a."organizationId" =');
    expect(rawSql).toContain("value->>'raw'");
  });

  it("lists asset statuses for asset reports and measurable statuses for booking reports", async () => {
    const asset = await loadReportFilterOptions({
      organizationId: "org-1",
      reportDef: reportWith(["status"]),
    });
    const booking = await loadReportFilterOptions({
      organizationId: "org-1",
      reportDef: compliance,
    });

    expect(asset.statuses.map((s) => s.value)).toEqual([
      "AVAILABLE",
      "IN_CUSTODY",
      "CHECKED_OUT",
    ]);
    expect(booking.statuses.map((s) => s.value)).not.toContain("DRAFT");
    expect(booking.statuses.map((s) => s.value)).toContain("COMPLETE");
  });
});
