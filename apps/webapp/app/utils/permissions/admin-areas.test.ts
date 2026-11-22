/**
 * Admin areas (sidebar, palette quick-nav): each shows with the matrix grant
 * of the page it opens.
 *
 * @see ./admin-areas.ts
 */
import type { OrganizationRoles } from "@prisma/client";
import type { AdminArea } from "./admin-areas";
import { ADMIN_AREA_GATES, canSeeAdminArea } from "./admin-areas";

const visible = (roles: OrganizationRoles[]) =>
  (Object.keys(ADMIN_AREA_GATES) as AdminArea[]).filter((area) =>
    canSeeAdminArea({ roles, area })
  );

describe("canSeeAdminArea", () => {
  it.each<[OrganizationRoles]>([["OWNER"], ["ADMIN"]])(
    "%s sees every area",
    (role) => {
      expect(visible([role])).toEqual(Object.keys(ADMIN_AREA_GATES));
    }
  );

  it("SELF_SERVICE sees only Audits", () => {
    expect(visible(["SELF_SERVICE"])).toEqual(["audits"]);
  });

  it("BASE sees only Audits", () => {
    expect(visible(["BASE"])).toEqual(["audits"]);
  });

  it("an empty membership sees nothing", () => {
    expect(visible([])).toEqual([]);
  });
});
