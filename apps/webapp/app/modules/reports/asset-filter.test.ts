/**
 * Shared asset predicate for reports: Prisma form and raw-SQL twin.
 *
 * @see {@link file://./asset-filter.ts}
 */

import type { Prisma } from "@prisma/client";
import { CustomFieldType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildReportAssetFilter,
  isReportFilterableCustomFieldType,
  mergeAssetWhere,
} from "./asset-filter";
import { WITHOUT_LOCATION_ID } from "./filter-params";

/** The SQL text of the fragments, for assertions on column names. */
function sqlText(fragments: Prisma.Sql[]): string {
  return fragments.map((f) => f.sql).join(" AND ");
}

describe("buildReportAssetFilter", () => {
  it("is empty when nothing is set", () => {
    const filter = buildReportAssetFilter({});

    expect(filter.isEmpty).toBe(true);
    expect(filter.where).toEqual({});
    expect(filter.sql).toEqual([]);
  });

  it("expresses categories, models and statuses in both forms", () => {
    const filter = buildReportAssetFilter({
      categoryIds: ["c1", "c2"],
      assetModelIds: ["m1"],
      statuses: ["AVAILABLE"],
    });

    expect(filter.isEmpty).toBe(false);
    expect(filter.where).toEqual({
      AND: [
        { categoryId: { in: ["c1", "c2"] } },
        { assetModelId: { in: ["m1"] } },
        { status: { in: ["AVAILABLE"] } },
      ],
    });
    const text = sqlText(filter.sql);
    expect(text).toContain('"categoryId" IN');
    expect(text).toContain('"assetModelId" IN');
    expect(text).toContain("status::text IN");
    // Values travel as parameters, never as text inside the SQL.
    expect(text).not.toContain("c1");
    expect(text).not.toContain("m1");
  });

  it("reads 'without location' as no placement rows, alone or with locations", () => {
    const alone = buildReportAssetFilter({
      locationIds: [WITHOUT_LOCATION_ID],
    });
    expect(alone.where).toEqual({ assetLocations: { none: {} } });
    expect(sqlText(alone.sql)).toContain(
      'NOT IN (SELECT "assetId" FROM "AssetLocation")'
    );

    const mixed = buildReportAssetFilter({
      locationIds: ["l1", WITHOUT_LOCATION_ID],
    });
    expect(mixed.where).toEqual({
      OR: [
        { assetLocations: { some: { locationId: { in: ["l1"] } } } },
        { assetLocations: { none: {} } },
      ],
    });
    expect(sqlText(mixed.sql)).toContain(" OR id NOT IN");
  });

  it("compares TEXT and OPTION custom fields on the stored raw text", () => {
    const filter = buildReportAssetFilter({
      customFieldValues: [
        { customFieldId: "f1", value: "yes", type: CustomFieldType.TEXT },
        { customFieldId: "f2", value: "Red", type: CustomFieldType.OPTION },
      ],
    });

    expect(filter.where).toEqual({
      AND: [
        {
          customFields: {
            some: {
              customFieldId: "f1",
              value: { path: ["raw"], equals: "yes" },
            },
          },
        },
        {
          customFields: {
            some: {
              customFieldId: "f2",
              value: { path: ["raw"], equals: "Red" },
            },
          },
        },
      ],
    });
    const text = sqlText(filter.sql);
    expect(text).toContain("value->>'raw' =");
    expect(text).toContain('"customFieldId" =');
    expect(filter.sql).toHaveLength(2);
  });

  it("compares BOOLEAN custom fields on the stored boolean, yes/no in", () => {
    const filter = buildReportAssetFilter({
      customFieldValues: [
        { customFieldId: "f1", value: "yes", type: CustomFieldType.BOOLEAN },
        { customFieldId: "f2", value: "No", type: CustomFieldType.BOOLEAN },
      ],
    });

    expect(filter.where).toEqual({
      AND: [
        {
          customFields: {
            some: {
              customFieldId: "f1",
              value: { path: ["valueBoolean"], equals: true },
            },
          },
        },
        {
          customFields: {
            some: {
              customFieldId: "f2",
              value: { path: ["valueBoolean"], equals: false },
            },
          },
        },
      ],
    });
    expect(sqlText(filter.sql)).toContain(
      "(value->>'valueBoolean')::boolean ="
    );
  });

  it("ignores custom-field filters it cannot express, in both forms at once", () => {
    const filter = buildReportAssetFilter({
      customFieldValues: [
        { customFieldId: "f1", value: "maybe", type: CustomFieldType.BOOLEAN },
        {
          customFieldId: "f2",
          value: "2026-01-01",
          type: CustomFieldType.DATE,
        },
        { customFieldId: "f3", value: "12", type: CustomFieldType.NUMBER },
      ],
    });

    expect(filter.isEmpty).toBe(true);
    expect(filter.sql).toEqual([]);
  });

  it("names the filterable custom field types", () => {
    expect(isReportFilterableCustomFieldType(CustomFieldType.TEXT)).toBe(true);
    expect(isReportFilterableCustomFieldType(CustomFieldType.OPTION)).toBe(
      true
    );
    expect(isReportFilterableCustomFieldType(CustomFieldType.BOOLEAN)).toBe(
      true
    );
    expect(isReportFilterableCustomFieldType(CustomFieldType.DATE)).toBe(false);
    expect(isReportFilterableCustomFieldType(CustomFieldType.AMOUNT)).toBe(
      false
    );
    expect(isReportFilterableCustomFieldType(CustomFieldType.NUMBER)).toBe(
      false
    );
    expect(
      isReportFilterableCustomFieldType(CustomFieldType.MULTILINE_TEXT)
    ).toBe(false);
  });
});

describe("mergeAssetWhere", () => {
  it("returns the base untouched for an empty or missing filter", () => {
    const base = { organizationId: "org" };

    expect(mergeAssetWhere(base, undefined)).toBe(base);
    expect(mergeAssetWhere(base, buildReportAssetFilter({}))).toBe(base);
  });

  it("ANDs the base and the filter so same-key clauses never overwrite", () => {
    const base: Prisma.AssetWhereInput = {
      organizationId: "org",
      assetLocations: { some: { locationId: "l1" } },
    };
    const filter = buildReportAssetFilter({ locationIds: ["l2"] });

    expect(mergeAssetWhere(base, filter)).toEqual({
      AND: [base, { assetLocations: { some: { locationId: { in: ["l2"] } } } }],
    });
  });
});
