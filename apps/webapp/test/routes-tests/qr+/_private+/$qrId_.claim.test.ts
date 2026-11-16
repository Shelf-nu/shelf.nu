// @vitest-environment node
/**
 * Who may claim an unclaimed QR code on the web, and which workspaces the
 * claim page offers.
 *
 * The claim page posts the target workspace in the FORM, not the selected one,
 * so the action judges the caller by their role in that workspace and by that
 * workspace's own permission switches: a non-member must not claim a code into
 * a stranger's workspace, a member without `qr:update` must not claim one into
 * their own, and nobody may claim into a workspace hidden from them (an SSO
 * user's personal workspace). Below Administrator only a Manager can hold
 * `qr:update`, and only while the owner has turned on "Managers can edit
 * assets" (`managersCanEditAssets`) in that workspace.
 *
 * The permission check runs for real; only the membership lookup and the claim
 * write are stubbed.
 *
 * @see {@link file://./../../../../app/routes/qr+/_private+/$qrId_.claim.tsx}
 * @see {@link file://./../../../../app/routes/api+/mobile+/qr.claim.ts} the mobile twin, gated the same way
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";
import { assertIsDataWithResponseInit } from "@helpers/assertions";

import { getSelectedOrganization } from "~/modules/organization/context.server";
import { claimQrCode } from "~/modules/qr/service.server";
import { action, loader } from "~/routes/qr+/_private+/$qrId_.claim";

// why: the claim page reads the QR code to confirm it is still unclaimed; the
// other reads and writes these cases depend on are behind the mocked services
// below.
vi.mock("~/database/db.server", () => ({
  db: {
    qr: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: "qr-1",
        organizationId: null,
      }),
    },
  },
}));

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
 * @param targetHidden - Whether the target is a membership the caller cannot
 *   see, as an SSO user's personal workspace is
 * @param targetSwitchOn - The target workspace's "Managers can edit assets"
 * @param selectedSwitchOn - The selected workspace's "Managers can edit assets"
 */
function givenMemberships(
  rolesInTarget: OrganizationRoles[] | null,
  {
    targetHidden = false,
    targetSwitchOn = false,
    selectedSwitchOn = false,
  } = {}
) {
  const selected = {
    id: SELECTED_WORKSPACE,
    managersCanEditAssets: selectedSwitchOn,
  };
  const memberships = [
    { organization: selected, roles: [OrganizationRoles.ADMIN] },
    ...(rolesInTarget
      ? [
          {
            organization: {
              id: TARGET_WORKSPACE,
              managersCanEditAssets: targetSwitchOn,
            },
            roles: rolesInTarget,
          },
        ]
      : []),
  ];

  vi.mocked(getSelectedOrganization).mockResolvedValue({
    organizationId: SELECTED_WORKSPACE,
    currentOrganization: selected,
    organizations: memberships
      .map((membership) => membership.organization)
      .filter((org) => !(targetHidden && org.id === TARGET_WORKSPACE)),
    userOrganizations: memberships,
  } as never);
}

describe("claim action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Posts the claim form naming the target workspace. */
  async function postClaim() {
    return action(
      createActionArgs({
        request: new Request("http://localhost/qr/qr-1/claim", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ organizationId: TARGET_WORKSPACE }),
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
    "refuses a %s of the workspace in the form, who lacks qr:update while its switch is off",
    async (role) => {
      givenMemberships([role]);

      expect(refusalStatus(await postClaim())).toBe(403);
      expect(claimQrCode).not.toHaveBeenCalled();
    }
  );

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "still refuses a %s once the workspace in the form has the switch on",
    async (role) => {
      givenMemberships([role], { targetSwitchOn: true });

      expect(refusalStatus(await postClaim())).toBe(403);
      expect(claimQrCode).not.toHaveBeenCalled();
    }
  );

  it("claims the code for a MANAGER once the workspace in the form has the switch on", async () => {
    givenMemberships([OrganizationRoles.MANAGER], { targetSwitchOn: true });

    const result = await postClaim();

    expect(claimQrCode).toHaveBeenCalledWith({
      id: "qr-1",
      organizationId: TARGET_WORKSPACE,
      userId: "user-1",
    });
    expect((result as Response).status).toBe(302);
  });

  it("refuses a MANAGER when only the selected workspace has the switch on", async () => {
    givenMemberships([OrganizationRoles.MANAGER], { selectedSwitchOn: true });

    expect(refusalStatus(await postClaim())).toBe(403);
    expect(claimQrCode).not.toHaveBeenCalled();
  });

  it("refuses an owner whose workspace in the form is hidden from them", async () => {
    givenMemberships([OrganizationRoles.OWNER], { targetHidden: true });

    expect(refusalStatus(await postClaim())).toBe(403);
    expect(claimQrCode).not.toHaveBeenCalled();
  });

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

describe("claim page loader", () => {
  /** Opens the claim page for code `qr-1`. */
  function loadClaimPage() {
    return loader(
      createLoaderArgs({
        request: new Request("http://localhost/qr/qr-1/claim"),
        params: { qrId: "qr-1" },
        context: { getSession: () => ({ userId: "user-1" }) } as never,
      })
    );
  }

  /** The ids of the workspaces the claim page offers. */
  function offeredWorkspaces(result: unknown) {
    return (result as { organizations: { id: string }[] }).organizations.map(
      (organization) => organization.id
    );
  }

  it("offers only the workspaces where the caller may claim a code, every switch off", async () => {
    const membership = (id: string, role: OrganizationRoles) => ({
      organization: { id },
      roles: [role],
    });
    vi.mocked(getSelectedOrganization).mockResolvedValue({
      organizationId: SELECTED_WORKSPACE,
      currentOrganization: { id: SELECTED_WORKSPACE },
      organizations: [
        { id: SELECTED_WORKSPACE },
        { id: "workspace-owned" },
        { id: "workspace-managed" },
        { id: "workspace-base" },
      ],
      userOrganizations: [
        membership(SELECTED_WORKSPACE, OrganizationRoles.ADMIN),
        membership("workspace-owned", OrganizationRoles.OWNER),
        membership("workspace-managed", OrganizationRoles.MANAGER),
        membership("workspace-base", OrganizationRoles.BASE),
      ],
    } as never);

    expect(offeredWorkspaces(await loadClaimPage())).toEqual([
      SELECTED_WORKSPACE,
      "workspace-owned",
    ]);
  });

  it("offers a managed workspace only when its own switch is on", async () => {
    const managedOn = {
      id: "workspace-managed-on",
      managersCanEditAssets: true,
    };
    const managedOff = {
      id: "workspace-managed-off",
      managersCanEditAssets: false,
    };
    const selected = { id: SELECTED_WORKSPACE, managersCanEditAssets: false };
    vi.mocked(getSelectedOrganization).mockResolvedValue({
      organizationId: SELECTED_WORKSPACE,
      currentOrganization: selected,
      organizations: [selected, managedOn, managedOff],
      userOrganizations: [
        { organization: selected, roles: [OrganizationRoles.ADMIN] },
        { organization: managedOn, roles: [OrganizationRoles.MANAGER] },
        { organization: managedOff, roles: [OrganizationRoles.MANAGER] },
      ],
    } as never);

    expect(offeredWorkspaces(await loadClaimPage())).toEqual([
      SELECTED_WORKSPACE,
      "workspace-managed-on",
    ]);
  });

  it("opens the page for a MANAGER sitting in a workspace with the switch on", async () => {
    const selected = { id: SELECTED_WORKSPACE, managersCanEditAssets: true };
    vi.mocked(getSelectedOrganization).mockResolvedValue({
      organizationId: SELECTED_WORKSPACE,
      currentOrganization: selected,
      organizations: [selected],
      userOrganizations: [
        { organization: selected, roles: [OrganizationRoles.MANAGER] },
      ],
    } as never);

    expect(offeredWorkspaces(await loadClaimPage())).toEqual([
      SELECTED_WORKSPACE,
    ]);
  });

  it("refuses the page to a MANAGER sitting in a workspace with the switch off", async () => {
    const selected = { id: SELECTED_WORKSPACE, managersCanEditAssets: false };
    vi.mocked(getSelectedOrganization).mockResolvedValue({
      organizationId: SELECTED_WORKSPACE,
      currentOrganization: selected,
      organizations: [selected],
      userOrganizations: [
        { organization: selected, roles: [OrganizationRoles.MANAGER] },
      ],
    } as never);

    const refusal = await loadClaimPage().catch((thrown: unknown) => thrown);

    assertIsDataWithResponseInit(refusal);
    expect(refusal.init?.status).toBe(403);
  });
});
