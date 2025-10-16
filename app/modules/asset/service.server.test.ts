import type { Prisma } from "@prisma/client";
import { describe, expect, it, beforeEach, vi } from "vitest";

import type {
  SortingDirection,
  SortingOptions,
} from "~/components/list/filters/sort-by";
import { db } from "~/database/db.server";
import { generateWhereClause } from "~/modules/asset/query.server";
import { getAssets } from "~/modules/asset/service.server";

vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

const findManyMock = vi.mocked(db.asset.findMany);
const countMock = vi.mocked(db.asset.count);

describe("asset service search", () => {
  beforeEach(() => {
    findManyMock.mockReset();
    countMock.mockReset();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
  });

  it("searches across all custom field value keys in simple mode", async () => {
    const searchTerm = "Custom Value";

    await getAssets({
      organizationId: "org_123",
      orderBy: "title" as SortingOptions,
      orderDirection: "asc" as SortingDirection,
      page: 1,
      perPage: 10,
      search: searchTerm,
    });

    expect(findManyMock).toHaveBeenCalled();
    const callArgs = findManyMock.mock.calls[0] as [Prisma.AssetFindManyArgs];
    expect(callArgs).toBeDefined();

    const [params] = callArgs;
    const { where } = params;

    const searchConditions = where?.OR?.[0]?.OR ?? [];
    const customFieldCondition = searchConditions.find(
      (condition: any) => condition?.customFields
    ) as any;

    expect(customFieldCondition).toBeDefined();

    const customFieldClauses = customFieldCondition!.customFields.some.OR ?? [];

    expect(customFieldClauses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: {
            path: ["valueText"],
            string_contains: searchTerm,
            mode: "insensitive",
          },
        }),
        expect.objectContaining({
          value: {
            path: ["valueMultiLineText"],
            string_contains: searchTerm,
            mode: "insensitive",
          },
        }),
        expect.objectContaining({
          value: {
            path: ["valueOption"],
            string_contains: searchTerm,
            mode: "insensitive",
          },
        }),
        expect.objectContaining({
          value: {
            path: ["raw"],
            string_contains: searchTerm,
            mode: "insensitive",
          },
        }),
      ])
    );

    expect(
      customFieldCondition.customFields.some.value,
      "custom field search should use OR clauses"
    ).toBeUndefined();
  });

  it("maps boolean-like search terms to boolean custom field lookups", async () => {
    await getAssets({
      organizationId: "org_123",
      orderBy: "title" as SortingOptions,
      orderDirection: "asc" as SortingDirection,
      page: 1,
      perPage: 10,
      search: "Yes",
    });

    const [params] = findManyMock.mock.calls[0] as [Prisma.AssetFindManyArgs];
    const customFieldClauses =
      params.where?.OR?.[0]?.OR?.find(
        (condition: any) => condition?.customFields
      )?.customFields?.some?.OR ?? [];

    expect(customFieldClauses).toEqual(
      expect.arrayContaining([
        {
          value: {
            path: ["valueBoolean"],
            equals: true,
          },
        },
      ])
    );
  });
});

describe("generateWhereClause", () => {
  it("searches custom fields across multiple value keys in advanced mode", () => {
    const clause = generateWhereClause("org_123", "needle", []);

    expect(clause.sql).toContain(
      "COALESCE(\n                acfv.value#>>'{valueText}',\n                acfv.value#>>'{valueMultiLineText}',\n                acfv.value#>>'{valueOption}',\n                acfv.value#>>'{raw}',\n                acfv.value#>>'{valueBoolean}'\n              ) ILIKE"
    );
  });
});
