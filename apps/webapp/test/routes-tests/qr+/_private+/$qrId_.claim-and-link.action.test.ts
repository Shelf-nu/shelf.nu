// @vitest-environment node
/**
 * Who may claim an unclaimed QR code, through either web door.
 *
 * The claim page and the link page both post a claim with the target workspace
 * in the FORM, not the selected one, so each action must judge the caller by
 * their role in that workspace: a non-member must not claim a code into a
 * stranger's workspace, and a member without `qr:update` (every role below
 * Administrator) must not claim one into their own.
 *
 * The permission check runs for real; only the membership lookup and the claim
 * write are stubbed.
 *
 * @see {@link file://./../../../../app/routes/qr+/_private+/$qrId_.claim.tsx}
 * @see {@link file://./../../../../app/routes/qr+/_private+/$qrId_.link.tsx}
 * @see {@link file://./../../../../app/routes/api+/mobile+/qr.claim.ts} the mobile twin, gated the same way
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";
import { assertIsDataWithResponseInit } from "@helpers/assertions";

import { getSelectedOrganization } from "~/modules/organization/context.server";
import { claimQrCode } from "~/modules/qr/service.server";
import { action as claimAction } from "~/routes/qr+/_private+/$qrId_.claim";
import { action as linkAction } from "~/routes/qr+/_private+/$qrId_.link";

// why: importing the routes pulls the Prisma client transitively; the reads
// and writes these cases depend on are behind the mocked services below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: memberships come from the session cookie and the database. They are the
// input these cases vary, so they are supplied directly; the permission check
// that consumes them is real.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi
    .fn()
    .mockResolvedValue("selected-organization-id=org; Path=/"),
}));

// why: the claim is a database write with its own coverage in
// qr/service.server.test.ts; these cases only pin whether it is reached.
vi.mock("~/modules/qr/service.server", () => ({
  claimQrCode: vi.fn().mockResolvedValue({}),
}));

/** The workspace the form names. */
const TARGET_WORKSPACE = "workspace-in-the-form";
/** The workspace whose cookie is set: one the caller administers. */
const SELECTED_WORKSPACE = "workspace-currently-selected";

/**
 * The caller administers the workspace they are sitting in and holds
 * `rolesInTarget` in the one the form names.
 *
 * @param rolesInTarget - Roles in the target workspace; `null` for no membership
 */
function givenMemberships(rolesInTarget: OrganizationRoles[] | null) {
  vi.mocked(getSelectedOrganization).mockResolvedValue({
    organizationId: SELECTED_WORKSPACE,
    organizations: [],
    currentOrganization: {},
    userOrganizations: [
      {
        organization: { id: SELECTED_WORKSPACE },
        roles: [OrganizationRoles.ADMIN],
      },
      ...(rolesInTarget
        ? [{ organization: { id: TARGET_WORKSPACE }, roles: rolesInTarget }]
        : []),
    ],
  } as never);
}

/** The two web doors that post a claim, with the extra fields each form sends. */
const doors: {
  name: string;
  action: typeof claimAction | typeof linkAction;
  url: string;
  fields: Record<string, string>;
}[] = [
  {
    name: "claim page",
    action: claimAction,
    url: "http://localhost/qr/qr-1/claim",
    fields: {},
  },
  {
    name: "link page",
    action: linkAction,
    url: "http://localhost/qr/qr-1/link",
    fields: { linkTo: "new" },
  },
];

describe.each(doors)("$name claim action", (door) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Posts the claim form naming the target workspace. */
  async function postClaim() {
    return door.action(
      createActionArgs({
        request: new Request(door.url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            organizationId: TARGET_WORKSPACE,
            ...door.fields,
          }),
        }),
        params: { qrId: "qr-1" },
        context: { getSession: () => ({ userId: "user-1" }) } as never,
      })
    );
  }

  /**
   * Reads the status of a refused claim.
   *
   * @param result - What the action returned
   * @returns The HTTP status the refusal was sent with
   */
  function refusalStatus(result: unknown) {
    assertIsDataWithResponseInit(result);
    return result.init?.status;
  }

  it("refuses a caller who is not a member of the workspace in the form", async () => {
    givenMemberships(null);

    expect(refusalStatus(await postClaim())).toBe(403);
    expect(claimQrCode).not.toHaveBeenCalled();
  });

  it.each([
    OrganizationRoles.MANAGER,
    OrganizationRoles.BASE,
    OrganizationRoles.SELF_SERVICE,
  ])(
    "refuses a %s of the workspace in the form, who lacks qr:update",
    async (role) => {
      givenMemberships([role]);

      expect(refusalStatus(await postClaim())).toBe(403);
      expect(claimQrCode).not.toHaveBeenCalled();
    }
  );

  it("claims the code for an administrator of the workspace in the form", async () => {
    givenMemberships([OrganizationRoles.ADMIN]);

    const result = await postClaim();

    expect(claimQrCode).toHaveBeenCalledWith({
      id: "qr-1",
      organizationId: TARGET_WORKSPACE,
      userId: "user-1",
    });
    expect((result as Response).status).toBe(302);
  });
});
