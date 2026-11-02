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
    customField: { findMany: vi.fn(), findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { db } from "~/database/db.server";
import {
  loadCustomFieldValues,
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
        where: {
          organizationId: "org-1",
          OR: [{ id: "tm-1" }, { userId: "tm-1" }],
        },
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

  it("reads a legacy custodian link that carries a user id", async () => {
    // Old Overdue Items links put the custodian's USER id in `custodian=`.
    vi.mocked(db.teamMember.findFirst).mockResolvedValue({
      id: "tm-1",
      name: "Sam Stone",
      user: null,
    } as any);

    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: new URLSearchParams("custodian=user-1"),
      reportDef: getReportById("overdue-items")!,
    });

    expect(db.teamMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org-1",
          OR: [{ id: "user-1" }, { userId: "user-1" }],
        },
      })
    );
    expect(resolved.teamMemberId).toBe("tm-1");
    // The chip removes the value the URL actually holds.
    expect(resolved.active[0]).toMatchObject({
      param: "teamMember",
      value: "user-1",
      label: "Custodian: Sam Stone",
    });
  });

  it("reads the legacy comma-joined category spelling into the predicate", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue([
      { id: "cat-1", name: "Cameras" },
      { id: "cat-2", name: "Lenses" },
    ] as any);

    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: new URLSearchParams("categories=cat-1,cat-2"),
      reportDef: inventory,
    });

    expect(resolved.params.categoryIds).toEqual(["cat-1", "cat-2"]);
    expect(resolved.assetFilter.where).toEqual({
      categoryId: { in: ["cat-1", "cat-2"] },
    });
  });

  it("counts the filters it had to leave out, so the page can say so", async () => {
    vi.mocked(db.category.findMany).mockResolvedValue([
      { id: "cat-1", name: "Cameras" },
    ] as any);
    vi.mocked(db.customField.findMany).mockResolvedValue([
      { id: "f-bool", name: "Insured", type: CustomFieldType.BOOLEAN },
    ] as any);

    const params = new URLSearchParams(
      "category=cat-1&category=cat-deleted&location=loc-deleted&teamMember=tm-deleted"
    );
    params.append("cf", "f-gone:yes");
    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: params,
      reportDef: getReportById("custody-snapshot")!,
    });

    expect(resolved.ignoredCount).toBe(4);
    expect(resolved.active.map((a) => a.value)).toEqual(["cat-1"]);
  });

  it("drops a boolean value it cannot read instead of showing a chip for it", async () => {
    vi.mocked(db.customField.findMany).mockResolvedValue([
      { id: "f-bool", name: "Insured", type: CustomFieldType.BOOLEAN },
    ] as any);

    const params = new URLSearchParams();
    params.append("cf", "f-bool:0");
    params.append("cf", "f-bool:TRUE");
    const resolved = await resolveReportFilters({
      organizationId: "org-1",
      searchParams: params,
      reportDef: inventory,
    });

    // The predicate ignores "0", so a "No" chip would claim a filter that
    // is not applied.
    expect(resolved.active.map((a) => a.label)).toEqual(["Insured: Yes"]);
    expect(resolved.ignoredCount).toBe(1);
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

  it("offers TEXT, OPTION and BOOLEAN custom fields, TEXT values on demand", async () => {
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
    const options = await loadReportFilterOptions({
      organizationId: "org-1",
      reportDef: reportWith(["custom_field"]),
    });

    expect(options.customFields).toEqual([
      {
        id: "f-text",
        name: "Fund",
        type: CustomFieldType.TEXT,
        values: [],
        hasMoreValues: false,
        valuesOnDemand: true,
      },
      {
        id: "f-opt",
        name: "Colour",
        type: CustomFieldType.OPTION,
        values: ["Red", "Blue"],
        hasMoreValues: false,
        valuesOnDemand: false,
      },
      {
        id: "f-bool",
        name: "Insured",
        type: CustomFieldType.BOOLEAN,
        values: ["yes", "no"],
        hasMoreValues: false,
        valuesOnDemand: false,
      },
    ]);
    // A TEXT field's distinct values are an aggregate over every asset, so
    // the page never pays for them: the picker asks when a field is opened.
    expect(db.$queryRaw).not.toHaveBeenCalled();
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

describe("loadCustomFieldValues", () => {
  beforeEach(() => {
    vi.mocked(db.$queryRaw).mockResolvedValue([] as any);
  });

  it("reads one TEXT field's values, most frequent first, scoped by workspace", async () => {
    vi.mocked(db.customField.findFirst).mockResolvedValue({
      id: "f-text",
    } as any);
    // A row past the limit signals that more values exist.
    vi.mocked(db.$queryRaw).mockResolvedValue([
      { value: "Perkins", rowNumber: 1 },
      { value: "General", rowNumber: 2 },
      { value: "overflow", rowNumber: 201 },
    ] as any);

    const result = await loadCustomFieldValues({
      organizationId: "org-1",
      customFieldId: "f-text",
    });

    expect(result).toEqual({ values: ["Perkins", "General"], hasMore: true });
    expect(db.customField.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "f-text",
          organizationId: "org-1",
          type: CustomFieldType.TEXT,
          active: true,
          deletedAt: null,
        },
      })
    );
    const rawSql = (
      vi.mocked(db.$queryRaw).mock.calls[0]?.[0] as { sql: string }
    ).sql;
    expect(rawSql).toContain('a."organizationId" =');
    expect(rawSql).toContain("value->>'raw'");
  });

  it("answers nothing for a field outside the workspace without reading values", async () => {
    vi.mocked(db.customField.findFirst).mockResolvedValue(null);

    const result = await loadCustomFieldValues({
      organizationId: "org-1",
      customFieldId: "f-foreign",
    });

    expect(result).toEqual({ values: [], hasMore: false });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
