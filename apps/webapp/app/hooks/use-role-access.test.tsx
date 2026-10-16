/**
 * Tests for {@link useRoleAccess}: it must read the same `roleAccess` object
 * the `_layout` loader resolved, and fall back to closed (BASE, every toggle
 * off) access before that loader's data exists.
 *
 * @see {@link file://./use-role-access.ts}
 */
import { renderHook } from "@testing-library/react";
import { useRouteLoaderData } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { resolveRoleAccess } from "~/utils/permissions/role-access";
import { useRoleAccess } from "./use-role-access";

// why: the hook reads the `_layout` route's loader data, which needs a data
// router; the roleAccess object in that payload is the variable under test.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useRouteLoaderData: vi.fn() };
});

describe("useRoleAccess", () => {
  it("returns the layout loader's roleAccess when present", () => {
    const adminAccess = resolveRoleAccess({
      roles: ["ADMIN"],
      workspace: {
        selfServiceCanSeeBookings: false,
        baseUserCanSeeBookings: false,
        selfServiceCanSeeCustody: false,
        baseUserCanSeeCustody: false,
      },
    });
    vi.mocked(useRouteLoaderData).mockReturnValue({ roleAccess: adminAccess });

    const { result } = renderHook(() => useRoleAccess());

    expect(result.current).toBe(adminAccess);
  });

  it("reads as closed BASE access before the layout data exists", () => {
    // why: the layout loader has not resolved yet (first paint, or a route
    // rendered outside its data), which useRouteLoaderData reports as
    // undefined; gates must stay closed rather than read as "unknown".
    vi.mocked(useRouteLoaderData).mockReturnValue(undefined);

    const { result } = renderHook(() => useRoleAccess());

    expect(result.current.role).toBe("BASE");
    expect(result.current.bookings.writeAll).toBe(false);
  });
});
