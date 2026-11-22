/**
 * useReservationIsRequest: a member without `booking:checkout` reserves as a
 * request someone else hands over.
 *
 * @see {@link file://./use-reservation-is-request.ts}
 */
import { renderHook } from "@testing-library/react";
import { useRouteLoaderData } from "react-router";
import { accessFor } from "@helpers/role-access";
import {
  useReservationIsRequest,
  useReservationWordedAsRequest,
} from "./use-reservation-is-request";

// why: the layout loader is the only source of the member's roles
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  useRouteLoaderData: vi.fn(),
}));

const withRoles = (roles: string[] | undefined) =>
  vi
    .mocked(useRouteLoaderData)
    .mockReturnValue(
      roles === undefined ? undefined : { currentOrganizationUserRoles: roles }
    );

describe("useReservationIsRequest", () => {
  it("is true for BASE, which cannot check out", () => {
    withRoles(["BASE"]);
    expect(renderHook(() => useReservationIsRequest()).result.current).toBe(
      true
    );
  });

  it("is false for SELF_SERVICE and ADMIN", () => {
    for (const role of ["SELF_SERVICE", "ADMIN"]) {
      withRoles([role]);
      expect(renderHook(() => useReservationIsRequest()).result.current).toBe(
        false
      );
    }
  });

  it("is false for a mixed [BASE, SELF_SERVICE] membership, which can check out", () => {
    // The matrix grant is the union over every held role, so the
    // SELF_SERVICE role's booking:checkout covers the whole membership.
    withRoles(["BASE", "SELF_SERVICE"]);
    expect(renderHook(() => useReservationIsRequest()).result.current).toBe(
      false
    );
  });

  it("is false while the roles are still loading", () => {
    withRoles(undefined);
    expect(renderHook(() => useReservationIsRequest()).result.current).toBe(
      false
    );
  });
});

describe("useReservationWordedAsRequest", () => {
  /** Layout data for one role and the workspace's approval switches. */
  const layoutFor = (
    role: "BASE" | "SELF_SERVICE" | "ADMIN",
    switches: {
      requireApprovalForBase: boolean;
      requireApprovalForSelfService: boolean;
    }
  ) =>
    vi.mocked(useRouteLoaderData).mockReturnValue({
      currentOrganizationUserRoles: [role],
      roleAccess: accessFor([role]),
      bookingSettings: switches,
    });

  it("words a Self service reservation as a request when its switch is on", () => {
    layoutFor("SELF_SERVICE", {
      requireApprovalForBase: false,
      requireApprovalForSelfService: true,
    });
    expect(
      renderHook(() => useReservationWordedAsRequest()).result.current
    ).toBe(true);
  });

  it("keeps a plain reserve for Self service while only Base needs approval", () => {
    layoutFor("SELF_SERVICE", {
      requireApprovalForBase: true,
      requireApprovalForSelfService: false,
    });
    expect(
      renderHook(() => useReservationWordedAsRequest()).result.current
    ).toBe(false);
  });

  it("always words a Base reservation as a request", () => {
    layoutFor("BASE", {
      requireApprovalForBase: false,
      requireApprovalForSelfService: false,
    });
    expect(
      renderHook(() => useReservationWordedAsRequest()).result.current
    ).toBe(true);
  });
});
