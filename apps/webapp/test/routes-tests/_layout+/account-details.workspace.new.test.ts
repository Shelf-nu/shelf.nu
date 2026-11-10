/**
 * New workspace route: linking the add-ons of a subscription that has no
 * workspace yet.
 *
 * Add-ons are linked when the creation link asks for them
 * (`includesAudits`, `includesBarcodes`) and also when
 * `findAddonsAwaitingWorkspace` finds them waiting on the user's subscription
 * for this workspace. A failed lookup adds nothing to what the creation link
 * asks for and never blocks the workspace.
 *
 * @see {@link file://./../../../app/routes/_layout+/account-details.workspace.new.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { sendEmail } from "~/emails/mail.server";
import { linkAuditAddonToOrganization } from "~/modules/audit/addon.server";
import { linkBarcodeAddonToOrganization } from "~/modules/barcode/addon.server";
import { createOrganization } from "~/modules/organization/service.server";
import { findAddonsAwaitingWorkspace } from "~/modules/stripe-webhook/helpers.server";

import { action } from "~/routes/_layout+/account-details.workspace.new";

// @vitest-environment node

// why: the workspace limit reads the user's tier from the database
vi.mock("~/utils/subscription.server", () => ({
  assertUserCanCreateMoreOrganizations: vi.fn(),
}));

// why: creating the workspace writes to the database and storage
vi.mock("~/modules/organization/service.server", () => ({
  createOrganization: vi.fn(),
}));

// why: the selected-workspace cookie needs the session secret
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("cookie"),
}));

// why: the lookup reads the user's Stripe subscriptions; what it answers is
// the input these tests vary
vi.mock("~/modules/stripe-webhook/helpers.server", () => ({
  findAddonsAwaitingWorkspace: vi.fn(),
}));

// why: the link helpers update the Stripe subscription and the workspace
vi.mock("~/modules/audit/addon.server", () => ({
  linkAuditAddonToOrganization: vi.fn(),
}));
vi.mock("~/modules/barcode/addon.server", () => ({
  linkBarcodeAddonToOrganization: vi.fn(),
}));

// why: the user and customer reads reach the database and Stripe
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({ id: "user-1", customerId: "cus_1" }),
}));
vi.mock("~/utils/stripe.server", () => ({
  getOrCreateCustomerId: vi.fn().mockResolvedValue("cus_1"),
}));

// why: email, notifications and logging reach external services
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

const context = { getSession: () => ({ userId: "user-1" }) } as never;

/** A workspace creation form post, optionally with creation-link params. */
function createWorkspaceRequest(search = "") {
  const formData = new FormData();
  formData.set("name", "ZZ Test Team");
  formData.set("currency", "USD");
  formData.set("image", new File([], ""));
  return new Request(
    `http://localhost:3000/account-details/workspace/new${search}`,
    { method: "POST", body: formData }
  );
}

describe("new workspace action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createOrganization).mockResolvedValue({ id: "org-new" } as never);
    vi.mocked(findAddonsAwaitingWorkspace).mockResolvedValue({
      audits: false,
      barcodes: false,
    });
  });

  it("links the add-ons waiting on the user's subscription to the new workspace", async () => {
    vi.mocked(findAddonsAwaitingWorkspace).mockResolvedValue({
      audits: true,
      barcodes: false,
    });

    const response = await action(
      createActionArgs({ request: createWorkspaceRequest(), context })
    );

    expect(findAddonsAwaitingWorkspace).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-new",
    });
    expect(linkAuditAddonToOrganization).toHaveBeenCalledWith({
      customerId: "cus_1",
      organizationId: "org-new",
    });
    expect(linkBarcodeAddonToOrganization).not.toHaveBeenCalled();
    expect((response as Response).status).toBe(302);
  });

  it("keeps linking the add-ons the creation link asks for", async () => {
    await action(
      createActionArgs({
        request: createWorkspaceRequest("?includesBarcodes=true"),
        context,
      })
    );

    expect(linkBarcodeAddonToOrganization).toHaveBeenCalledWith({
      customerId: "cus_1",
      organizationId: "org-new",
    });
    expect(linkAuditAddonToOrganization).not.toHaveBeenCalled();
  });

  it("still creates the workspace when the lookup fails, and links nothing unasked", async () => {
    vi.mocked(findAddonsAwaitingWorkspace).mockRejectedValue(
      new Error("Stripe unavailable")
    );

    const response = await action(
      createActionArgs({ request: createWorkspaceRequest(), context })
    );

    expect((response as Response).status).toBe(302);
    expect(linkAuditAddonToOrganization).not.toHaveBeenCalled();
    expect(linkBarcodeAddonToOrganization).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
