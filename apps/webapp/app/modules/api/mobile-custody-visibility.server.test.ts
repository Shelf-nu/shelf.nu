/**
 * Test suite for the pure mobile custody-visibility helpers.
 *
 * Pins the server-side twin of the web's custody-visibility rules
 * (`userHasCustodyViewPermission` / `userCanViewSpecificCustody` /
 * QuantityCustodyList's own-rows filter) so the mobile API can never drift
 * from the web semantics. Pure module — no mocks needed.
 *
 * @see {@link file://./mobile-custody-visibility.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import {
  computeCanSeeAllCustody,
  filterMobileCustodyListForViewer,
  viewerCanSeeLegacyCustody,
} from "./mobile-custody-visibility.server";

// @vitest-environment node

const noOverrides = {
  selfServiceCanSeeCustody: false,
  baseUserCanSeeCustody: false,
};

describe("computeCanSeeAllCustody", () => {
  it("always allows ADMIN and OWNER", () => {
    expect(
      computeCanSeeAllCustody({
        role: OrganizationRoles.ADMIN,
        organization: noOverrides,
      })
    ).toBe(true);
    expect(
      computeCanSeeAllCustody({
        role: OrganizationRoles.OWNER,
        organization: noOverrides,
      })
    ).toBe(true);
  });

  it("denies SELF_SERVICE and BASE without their org override", () => {
    expect(
      computeCanSeeAllCustody({
        role: OrganizationRoles.SELF_SERVICE,
        organization: noOverrides,
      })
    ).toBe(false);
    expect(
      computeCanSeeAllCustody({
        role: OrganizationRoles.BASE,
        organization: noOverrides,
      })
    ).toBe(false);
  });

  it("allows SELF_SERVICE/BASE only via their MATCHING org override", () => {
    expect(
      computeCanSeeAllCustody({
        role: OrganizationRoles.SELF_SERVICE,
        organization: {
          selfServiceCanSeeCustody: true,
          baseUserCanSeeCustody: false,
        },
      })
    ).toBe(true);
    expect(
      computeCanSeeAllCustody({
        role: OrganizationRoles.BASE,
        organization: {
          selfServiceCanSeeCustody: false,
          baseUserCanSeeCustody: true,
        },
      })
    ).toBe(true);
    // Cross-override must NOT leak: the base override doesn't cover
    // self-service and vice versa
    expect(
      computeCanSeeAllCustody({
        role: OrganizationRoles.SELF_SERVICE,
        organization: {
          selfServiceCanSeeCustody: false,
          baseUserCanSeeCustody: true,
        },
      })
    ).toBe(false);
    expect(
      computeCanSeeAllCustody({
        role: OrganizationRoles.BASE,
        organization: {
          selfServiceCanSeeCustody: true,
          baseUserCanSeeCustody: false,
        },
      })
    ).toBe(false);
  });
});

describe("filterMobileCustodyListForViewer", () => {
  const custodyRows = [
    { custodian: { id: "tm-me", userId: "user-1" } },
    { custodian: { id: "tm-other", userId: "user-2" } },
    { custodian: { id: "tm-nrm", userId: null } },
  ];
  const custodyList = [
    { custodian: { id: "tm-me", name: "Me" }, quantity: 3 },
    { custodian: { id: "tm-other", name: "Other" }, quantity: 5 },
    { custodian: { id: "tm-nrm", name: "NRM" }, quantity: 1 },
  ];

  it("passes everything through untouched when the viewer can see all", () => {
    const result = filterMobileCustodyListForViewer({
      custodyList,
      custodyRows,
      viewerUserId: "user-1",
      canSeeAllCustody: true,
    });
    expect(result.custodyList).toEqual(custodyList);
    expect(result.custodyListOthersCount).toBe(0);
  });

  it("filters to the viewer's own entries and counts hidden holders", () => {
    const result = filterMobileCustodyListForViewer({
      custodyList,
      custodyRows,
      viewerUserId: "user-1",
      canSeeAllCustody: false,
    });
    expect(result.custodyList).toEqual([
      { custodian: { id: "tm-me", name: "Me" }, quantity: 3 },
    ]);
    expect(result.custodyListOthersCount).toBe(2);
  });

  it("hides everything (with a full count) when the viewer holds nothing", () => {
    const result = filterMobileCustodyListForViewer({
      custodyList,
      custodyRows,
      viewerUserId: "user-99",
      canSeeAllCustody: false,
    });
    expect(result.custodyList).toEqual([]);
    expect(result.custodyListOthersCount).toBe(3);
  });
});

describe("viewerCanSeeLegacyCustody", () => {
  it("always lets the custodian see their own custody", () => {
    expect(
      viewerCanSeeLegacyCustody({
        custodianUserId: "user-1",
        viewerUserId: "user-1",
        canSeeAllCustody: false,
      })
    ).toBe(true);
  });

  it("falls back to the general permission for other holders", () => {
    expect(
      viewerCanSeeLegacyCustody({
        custodianUserId: "user-2",
        viewerUserId: "user-1",
        canSeeAllCustody: false,
      })
    ).toBe(false);
    expect(
      viewerCanSeeLegacyCustody({
        custodianUserId: "user-2",
        viewerUserId: "user-1",
        canSeeAllCustody: true,
      })
    ).toBe(true);
  });

  it("treats a non-registered custodian (null userId) as not-the-viewer", () => {
    expect(
      viewerCanSeeLegacyCustody({
        custodianUserId: null,
        viewerUserId: "user-1",
        canSeeAllCustody: false,
      })
    ).toBe(false);
  });
});
