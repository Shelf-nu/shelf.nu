/**
 * Location where-clause builders.
 *
 * These exist so a bulk "select all" resolves the SAME set the list on screen
 * resolved. The list and the resolver therefore have to search the same fields:
 * a resolver that matched fewer of them would quietly act on a different set of
 * locations than the operator was looking at.
 *
 * @see {@link file://./utils.server.ts}
 * @see {@link file://./service.server.ts} getLocations — the list this mirrors
 */
import { describe, expect, it } from "vitest";

import { getLocationsWhereInput } from "./utils.server";

describe("getLocationsWhereInput", () => {
  const organizationId = "org-1";

  it("searches name, description and address, as the list does", () => {
    expect.assertions(1);

    const where = getLocationsWhereInput({
      organizationId,
      currentSearchParams: "s=warehouse",
    });

    expect(where.OR).toEqual([
      { name: { contains: "warehouse", mode: "insensitive" } },
      { description: { contains: "warehouse", mode: "insensitive" } },
      { address: { contains: "warehouse", mode: "insensitive" } },
    ]);
  });

  it("accepts an already-parsed search term", () => {
    expect.assertions(1);

    const where = getLocationsWhereInput({
      organizationId,
      search: "warehouse",
    });

    expect(where.OR).toEqual([
      { name: { contains: "warehouse", mode: "insensitive" } },
      { description: { contains: "warehouse", mode: "insensitive" } },
      { address: { contains: "warehouse", mode: "insensitive" } },
    ]);
  });

  it("scopes to the organization and adds no predicate without a search", () => {
    expect.assertions(1);

    expect(
      getLocationsWhereInput({ organizationId, currentSearchParams: null })
    ).toEqual({ organizationId });
  });

  it("ignores a whitespace-only search", () => {
    expect.assertions(1);

    expect(
      getLocationsWhereInput({
        organizationId,
        currentSearchParams: "s=%20%20",
      })
    ).toEqual({ organizationId });
  });

  it("trims the search term", () => {
    expect.assertions(1);

    const where = getLocationsWhereInput({
      organizationId,
      currentSearchParams: "s=%20warehouse%20",
    });

    expect(where.OR?.[0]).toEqual({
      name: { contains: "warehouse", mode: "insensitive" },
    });
  });
});
