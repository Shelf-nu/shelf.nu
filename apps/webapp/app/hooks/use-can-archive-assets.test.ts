/**
 * Who may archive and reinstate assets, and so who sees the Archived view
 * (issue #382). The grant is `asset: archive`: ADMIN and OWNER hold it, BASE
 * and SELF_SERVICE do not.
 *
 * BASE and SELF_SERVICE exist to consume the AVAILABLE inventory — BASE plans
 * bookings and runs audits, SELF_SERVICE runs a booking end to end. An
 * archived asset is out of service and neither role can reinstate it, so the
 * tab would show them things they can neither use nor fix.
 *
 * @see {@link file://./use-can-archive-assets.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCanArchiveAssets } from "./use-can-archive-assets";

const mockRoles = vi.hoisted(() => ({
  current: undefined as OrganizationRoles[] | undefined,
}));

// why: the real hook reads the `_layout` route loader, which needs a data
// router; the roles it returns are the only input this hook has.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => mockRoles.current,
}));

/** Renders the hook for a membership and returns its answer. */
const canArchive = (roles: OrganizationRoles[] | undefined) => {
  mockRoles.current = roles;
  return renderHook(() => useCanArchiveAssets()).result.current;
};

describe("who may archive and reinstate assets", () => {
  beforeEach(() => {
    mockRoles.current = undefined;
  });

  it("allows OWNER and ADMIN", () => {
    expect(canArchive([OrganizationRoles.OWNER])).toBe(true);
    expect(canArchive([OrganizationRoles.ADMIN])).toBe(true);
  });

  it("refuses BASE, who plans bookings and cannot reinstate", () => {
    expect(canArchive([OrganizationRoles.BASE])).toBe(false);
  });

  it("refuses SELF_SERVICE, who books and takes custody for themselves", () => {
    expect(canArchive([OrganizationRoles.SELF_SERVICE])).toBe(false);
  });

  it("refuses while the layout data has not loaded", () => {
    // The gate must fail closed, not flash the Archived view.
    expect(canArchive(undefined)).toBe(false);
    expect(canArchive([])).toBe(false);
  });
});
