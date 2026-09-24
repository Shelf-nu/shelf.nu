import { OrganizationRoles } from "@prisma/client";

/**
 * Factory for the `routes/_layout+/_layout` loader payload.
 *
 * Components under `_layout` read this through `useRouteLoaderData`-backed
 * hooks (`useUserRoleHelper`, `useIsShelfAdmin`, `useCurrentOrganization`), so
 * a test mocking that hook has to hand back a payload of this shape. Shared
 * because the ownership-transfer surfaces render on two different pages and
 * their fixtures must not drift apart.
 *
 * @see {@link file://./../../app/routes/_layout+/_layout.tsx}
 */

/** Owner email used by the default payload, for tests asserting on the text */
export const OWNER_EMAIL = "owner@example.com";

/** Knobs for {@link createLayoutLoaderData} */
type CreateLayoutLoaderDataArgs = {
  /** The viewer's roles in the current workspace */
  roles?: OrganizationRoles[];
  /** Shelf staff admin (platform-wide `Roles.ADMIN`), not a workspace role */
  isShelfAdmin?: boolean;
  /** `null` mirrors a loader payload that stopped selecting the owner. */
  owner?: { id: string; email: string } | null;
};

/**
 * Builds a `_layout` loader payload for tests.
 *
 * @param args - See {@link CreateLayoutLoaderDataArgs}
 * @returns The payload shape `useRouteLoaderData("routes/_layout+/_layout")` returns
 */
export function createLayoutLoaderData({
  roles = [OrganizationRoles.ADMIN],
  isShelfAdmin = false,
  owner = { id: "owner-1", email: OWNER_EMAIL },
}: CreateLayoutLoaderDataArgs = {}) {
  return {
    currentOrganizationUserRoles: roles,
    currentOrganization: {
      id: "org-1",
      name: "Test Org",
      owner,
    },
    // Shelf staff admin flag, as derived by the _layout loader
    isAdmin: isShelfAdmin,
    user: { id: "user-1" },
  };
}
