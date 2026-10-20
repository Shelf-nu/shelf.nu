/**
 * useReservationIsRequest: a member without `booking:checkout` reserves as a
 * request someone else hands over.
 *
 * @see {@link file://./use-reservation-is-request.ts}
 */
import { renderHook } from "@testing-library/react";
import { useRouteLoaderData } from "react-router";
import { useReservationIsRequest } from "./use-reservation-is-request";

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
