// @vitest-environment node
/**
 * Advanced assets index loader: the last audit date gate.
 *
 * Before anything reads filters, the loader removes the last audit date
 * column for callers who may not see it (hidden), and drops a last audit date
 * filter for anyone who may not query it (hidden or locked). The filtered list
 * then feeds the asset query AND the model rollup, so this is the only guard
 * for the rollup.
 *
 * This asserts the WIRING only. The loader goes on to read a dozen other
 * things, so the first read after the gate (`getAllSelectedValuesFromFilters`)
 * records its arguments and rejects on purpose, and the loader stops there.
 *
 * @see {@link file://./data.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";

import type { Column } from "~/modules/asset-index-settings/helpers";

// why: importing the loader pulls in `db.server`, which would otherwise open a
// real PostgreSQL connection.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the filters come from a cookie or the URL; the test fixes them.
vi.mock("~/utils/cookies.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAdvancedFiltersFromRequest: vi.fn(() =>
    Promise.resolve({
      filters: "lastAuditDate=isEmpty:&category=c1",
      serializedCookie: null,
      redirectNeeded: false,
    })
  ),
}));

const { mockParseFilters } = vi.hoisted(() => ({
  mockParseFilters: vi.fn(),
}));
// why: parsing expands location hierarchies from the database; the test
// returns both filters and records which columns the loader parsed against.
vi.mock("./query.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  parseFiltersWithHierarchy: mockParseFilters,
}));

const { mockSelectedValues } = vi.hoisted(() => ({
  mockSelectedValues: vi.fn(),
}));
// why: the first read after the gate. It rejects on purpose so the loader
// stops right after the gate, with the filters it was handed recorded.
vi.mock("./utils.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAllSelectedValuesFromFilters: mockSelectedValues,
}));

// why: the audits add-on rule also reads premium env flags; it is reduced to
// the workspace's own flag.
vi.mock("~/utils/subscription.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  canUseAudits: (org: { auditsEnabled: boolean }) => org.auditsEnabled,
}));

import { advancedModeLoader } from "./data.server";

const columns = [
  { name: "category", visible: true, position: 1 },
  { name: "lastAuditDate", visible: true, position: 2 },
] as Column[];

/** Runs the loader up to the stop read for `roles` and the add-on flag. */
async function load(roles: OrganizationRoles[], auditsEnabled: boolean) {
  const ctx = permissionContext({ roles });
  await expect(
    advancedModeLoader({
      request: new Request("http://localhost/assets"),
      userId: "user-1",
      organizationId: "org-1",
      organizations: [],
      role: roles[0],
      currentOrganization: {
        ...ctx.currentOrganization,
        auditsEnabled,
      },
      user: { firstName: "A", lastName: "B", displayName: null },
      settings: { mode: "ADVANCED", columns },
      canSeeAllCustody: true,
      access: ctx.access,
    } as unknown as Parameters<typeof advancedModeLoader>[0])
  ).rejects.toBeDefined();
  expect(mockSelectedValues).toHaveBeenCalledTimes(1);

  const parsedAgainst = (mockParseFilters.mock.calls[0][1] as Column[]).map(
    (c) => c.name
  );
  const handedOn = (
    mockSelectedValues.mock.calls[0][3] as { name: string }[]
  ).map((f) => f.name);
  return { parsedAgainst, handedOn };
}

describe("advancedModeLoader: last audit date gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseFilters.mockResolvedValue([
      { name: "lastAuditDate", type: "date", operator: "isEmpty", value: "" },
      { name: "category", type: "enum", operator: "is", value: "c1" },
    ]);
    mockSelectedValues.mockRejectedValue(new Error("stop after the gate"));
  });

  it("keeps the column and the filter when audits are available", async () => {
    const { parsedAgainst, handedOn } = await load(
      [OrganizationRoles.ADMIN],
      true
    );

    expect(parsedAgainst).toContain("lastAuditDate");
    expect(handedOn).toEqual(["lastAuditDate", "category"]);
  });

  it("keeps the column but drops the filter when audits are locked", async () => {
    const { parsedAgainst, handedOn } = await load(
      [OrganizationRoles.ADMIN],
      false
    );

    expect(parsedAgainst).toContain("lastAuditDate");
    expect(handedOn).toEqual(["category"]);
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "removes the column and drops the filter for a %s caller",
    async (role) => {
      const { parsedAgainst, handedOn } = await load([role], true);

      expect(parsedAgainst).not.toContain("lastAuditDate");
      expect(handedOn).toEqual(["category"]);
    }
  );
});
