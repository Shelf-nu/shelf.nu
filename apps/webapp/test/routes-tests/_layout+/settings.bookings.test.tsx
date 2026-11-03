/**
 * Settings > Bookings: the PDF template intents and the template data the
 * loader hands the card.
 *
 * The workspace gate (`canUseBookings` / `assertCanUseBookings`) runs for
 * real with the premium switch on, so a PERSONAL workspace is refused by the
 * production rule and not by a stub.
 *
 * @see {@link file://../../../app/routes/_layout+/settings.bookings.tsx}
 */
import { Currency, OrganizationRoles, OrganizationType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import {
  createPdfTemplate,
  deletePdfTemplate,
  duplicatePdfTemplate,
  getPdfTemplates,
  setDefaultPdfTemplate,
  updatePdfTemplate,
} from "~/modules/pdf-template/service.server";
import { action, loader } from "~/routes/_layout+/settings.bookings";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";

// why: premium features are an environment switch; turning it on makes the
// real `canUseBookings` refuse every workspace that is not a TEAM workspace.
vi.mock("~/config/shelf.config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/config/shelf.config")>();
  return {
    ...actual,
    config: { ...actual.config, enablePremiumFeatures: true },
  };
});

// why: the loader reads the workspace's custom fields from the database
vi.mock("~/database/db.server", () => ({
  db: {
    customField: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// why: the template rules run against the database and have their own tests
// (`modules/pdf-template/service.server.test.ts`); this suite is about the
// route's gate and how it reads the form.
vi.mock("~/modules/pdf-template/service.server", () => ({
  getPdfTemplates: vi.fn().mockResolvedValue([]),
  createPdfTemplate: vi.fn(),
  updatePdfTemplate: vi.fn(),
  duplicatePdfTemplate: vi.fn(),
  setDefaultPdfTemplate: vi.fn(),
  deletePdfTemplate: vi.fn(),
}));

// why: the other loader reads are database-backed and not under test here
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({}),
  updateAlwaysNotifyTeamMembers: vi.fn(),
  updateBookingSettings: vi.fn(),
}));
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn().mockResolvedValue({}),
  createWorkingHoursOverride: vi.fn(),
  deleteWorkingHoursOverride: vi.fn(),
  toggleWorkingHours: vi.fn(),
  updateWorkingHoursSchedule: vi.fn(),
}));
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMembersForNotify: vi.fn().mockResolvedValue({}),
}));
vi.mock("~/modules/booking/service.server", () => ({
  scheduleExpiryArchiveForExistingReservations: vi.fn(),
}));

// why: Stripe is initialised at import by billing helpers
vi.mock("~/utils/stripe.server", () => ({
  premiumIsEnabled: true,
  getOwnerSubscriptionInfo: vi.fn(),
  userHasActiveSubscription: vi.fn(),
}));

// why: the permission lookup reads the session and the database
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: notifications go through an event emitter
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const requirePermissionMock = vi.mocked(requirePermission);

const mockContext = {
  getSession: () => ({ userId: "user-1" }),
  setSession: vi.fn(),
  destroySession: vi.fn(),
  commitSession: vi.fn(),
  isAuthenticated: true,
  appVersion: "test",
} as any;

function baseOrganization(type: OrganizationType = OrganizationType.TEAM) {
  return {
    id: "org-1",
    name: "Test Org",
    type,
    currency: Currency.USD,
    userId: "owner-1",
  };
}

function grant(
  role: OrganizationRoles,
  type: OrganizationType = OrganizationType.TEAM
) {
  requirePermissionMock.mockResolvedValue({
    organizationId: "org-1",
    currentOrganization: baseOrganization(type),
    role,
    access: accessFor([role]),
    organizations: [baseOrganization(type)],
    userOrganizations: [],
    canUseBarcodes: false,
  } as any);
}

describe("settings.bookings loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant(OrganizationRoles.ADMIN);
  });

  it("lists the workspace's templates in the loader", async () => {
    const templates = [{ id: "template-1", name: "Checklist" }];
    vi.mocked(getPdfTemplates).mockResolvedValue(templates as any);
    const fields = [{ id: "cf-1", name: "Serial", type: "TEXT", active: true }];
    vi.mocked(db.customField.findMany).mockResolvedValue(fields as any);

    const response = (await loader(
      createLoaderArgs({
        context: mockContext,
        request: new Request("http://localhost/settings/bookings"),
        params: {},
      })
    )) as unknown as { data?: Record<string, unknown> };
    const body = (response.data ?? response) as Record<string, unknown>;

    expect(getPdfTemplates).toHaveBeenCalledWith({ organizationId: "org-1" });
    expect(db.customField.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", deletedAt: null },
      select: { id: true, name: true, type: true, active: true },
      orderBy: { name: "asc" },
    });
    expect(body.pdfTemplates).toEqual(templates);
    expect(body.templateCustomFields).toEqual(fields);
  });
});

describe("settings.bookings PDF templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant(OrganizationRoles.ADMIN);
  });

  function post(fields: [string, string][]) {
    const body = new URLSearchParams(fields);
    return action(
      createActionArgs({
        context: mockContext,
        request: new Request("http://localhost/settings/bookings", {
          method: "POST",
          body,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }),
        params: {},
      })
    ) as Promise<{ init?: { status?: number } }>;
  }

  const templateForm = (customFieldIds: string[]): [string, string][] => [
    ["intent", "save-template"],
    ["templateId", "template-1"],
    ["name", "  Client quote  "],
    ["columns.image", "off"],
    ["columns.quantity", "off"],
    ["columns.quantity", "on"],
    ["columns.kit", "on"],
    ["columns.category", "on"],
    ["columns.location", "off"],
    ...customFieldIds.map((id, i): [string, string] => [
      `customFieldIds[${i}]`,
      id,
    ]),
    ["assetDescription", "off"],
    ["groupBy", "category"],
    ["sortBy", "name"],
    ["bookingDescription", "off"],
    ["totalValue", "on"],
    ["signatureLines", "on"],
  ];

  it("lets only owners and admins change templates: the gate is working hours update", async () => {
    const refusal = new ShelfError({
      cause: null,
      message: "You are not allowed to do this.",
      label: "Permission",
      status: 403,
      shouldBeCaptured: false,
    });
    requirePermissionMock.mockRejectedValue(refusal);

    const response = await post([
      ["intent", "delete-template"],
      ["templateId", "template-1"],
    ]);

    expect(response.init?.status).toBe(403);
    expect(deletePdfTemplate).not.toHaveBeenCalled();
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.workingHours,
        action: PermissionAction.update,
      })
    );
    for (const role of [
      OrganizationRoles.BASE,
      OrganizationRoles.SELF_SERVICE,
    ]) {
      expect(
        userHasPermission({
          roles: [role],
          entity: PermissionEntity.workingHours,
          action: PermissionAction.update,
        })
      ).toBe(false);
    }
  });

  it("adds a template by name", async () => {
    vi.mocked(createPdfTemplate).mockResolvedValue({
      id: "template-2",
      name: "Client quote",
    } as any);

    await post([
      ["intent", "add-template"],
      ["name", "Client quote"],
    ]);

    expect(createPdfTemplate).toHaveBeenCalledWith({
      organizationId: "org-1",
      name: "Client quote",
    });
  });

  it("deletes a template in the caller's workspace only", async () => {
    await post([
      ["intent", "delete-template"],
      ["templateId", "template-1"],
    ]);

    expect(deletePdfTemplate).toHaveBeenCalledWith({
      organizationId: "org-1",
      templateId: "template-1",
    });
  });

  it("duplicates a template in the caller's workspace", async () => {
    await post([
      ["intent", "duplicate-template"],
      ["templateId", "template-1"],
    ]);

    expect(duplicatePdfTemplate).toHaveBeenCalledWith({
      organizationId: "org-1",
      templateId: "template-1",
    });
  });

  it("makes a template the default in the caller's workspace", async () => {
    await post([
      ["intent", "default-template"],
      ["templateId", "template-1"],
    ]);

    expect(setDefaultPdfTemplate).toHaveBeenCalledWith({
      organizationId: "org-1",
      templateId: "template-1",
    });
  });

  it("saves the form as the template's name and config, empty custom field slots dropped", async () => {
    await post(templateForm(["cf-price", "none", "cf-serial"]));

    expect(updatePdfTemplate).toHaveBeenCalledWith({
      organizationId: "org-1",
      templateId: "template-1",
      name: "Client quote",
      config: {
        columns: {
          image: false,
          quantity: true,
          kit: true,
          category: true,
          location: false,
        },
        customFieldIds: ["cf-price", "cf-serial"],
        assetDescription: false,
        groupBy: "category",
        sortBy: "name",
        bookingDescription: false,
        totalValue: true,
        signatureLines: true,
      },
    });
  });

  it("refuses a fourth custom field before anything is saved", async () => {
    const response = await post(templateForm(["cf-1", "cf-2", "cf-3", "cf-4"]));

    expect(response.init?.status).toBe(400);
    expect(updatePdfTemplate).not.toHaveBeenCalled();
  });

  it("refuses a template write from a personal workspace", async () => {
    grant(OrganizationRoles.OWNER, OrganizationType.PERSONAL);

    const response = await post([
      ["intent", "add-template"],
      ["name", "Client quote"],
    ]);

    expect(response.init?.status).toBe(403);
    expect(createPdfTemplate).not.toHaveBeenCalled();
  });
});
