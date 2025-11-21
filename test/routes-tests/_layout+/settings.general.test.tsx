import { Currency, OrganizationRoles, OrganizationType } from "@prisma/client";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createLoaderArgs, createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import {
  getOrganizationAdmins,
  updateOrganization,
} from "~/modules/organization/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { action, loader } from "~/routes/_layout+/settings.general";
import { requirePermission } from "~/utils/roles.server";
import {
  canExportAssets,
  canHideShelfBranding,
} from "~/utils/subscription.server";

// why: mock parseFormData to avoid actual file upload in tests
vi.mock("@remix-run/form-data-parser", () => ({
  parseFormData: vi.fn(async () => new FormData()),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationAdmins: vi.fn(),
  transferOwnership: vi.fn(),
  updateOrganization: vi.fn(),
  updateOrganizationPermissions: vi.fn(),
}));

vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: vi.fn(),
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/utils/subscription.server", () => ({
  canExportAssets: vi.fn(),
  canHideShelfBranding: vi.fn(),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

const dbMock = db as unknown as {
  user: {
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
};
const getOrganizationTierLimitMock = vi.mocked(getOrganizationTierLimit);
const getOrganizationAdminsMock = vi.mocked(getOrganizationAdmins);
const updateOrganizationMock = vi.mocked(updateOrganization);
const requirePermissionMock = vi.mocked(requirePermission);
const canExportAssetsMock = vi.mocked(canExportAssets);
const canHideShelfBrandingMock = vi.mocked(canHideShelfBranding);

const mockContext = {
  getSession: () => ({ userId: "user-1" }),
  setSession: vi.fn(),
  destroySession: vi.fn(),
  commitSession: vi.fn(),
  isAuthenticated: true,
  appVersion: "test",
} as any;

function baseOrganization() {
  return {
    id: "org-1",
    name: "Test Org",
    type: OrganizationType.TEAM,
    currency: Currency.USD,
    qrIdDisplayPreference: "QR_ID" as const,
    showShelfBranding: true,
    enabledSso: false,
    userId: "owner-1",
    imageId: null,
    updatedAt: new Date(),
    ssoDetails: null,
    workspaceDisabled: false,
    selfServiceCanSeeCustody: false,
    selfServiceCanSeeBookings: false,
    baseUserCanSeeCustody: false,
    baseUserCanSeeBookings: false,
    barcodesEnabled: false,
    hasSequentialIdsMigrated: false,
    owner: { id: "owner-1", email: "owner@example.com" },
  };
}

describe("settings.general loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      organizations: [baseOrganization()],
      currentOrganization: baseOrganization(),
      role: OrganizationRoles.OWNER,
      isSelfServiceOrBase: false,
      userOrganizations: [],
      canSeeAllBookings: true,
      canSeeAllCustody: true,
      canUseBarcodes: false,
    } as any);

    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      firstName: "Carlos",
      tierId: "tier_2",
      userOrganizations: [],
    });

    getOrganizationTierLimitMock.mockResolvedValue({
      id: "tier_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      canImportAssets: true,
      canExportAssets: true,
      canImportNRM: true,
      canHideShelfBranding: true,
      maxCustomFields: 0,
      maxOrganizations: 1,
    } as any);

    getOrganizationAdminsMock.mockResolvedValue([]);
    canExportAssetsMock.mockReturnValue(true);
    canHideShelfBrandingMock.mockReturnValue(true);
  });

  it("includes canHideShelfBranding in the loader payload", async () => {
    const result = await loader(
      createLoaderArgs({
        context: mockContext,
        request: new Request("http://localhost/settings/general"),
        params: {},
      })
    );

    expect(canHideShelfBrandingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canHideShelfBranding: true,
      })
    );

    expect(result).toEqual(
      expect.objectContaining({
        canHideShelfBranding: true,
      })
    );
  });

  it("prevents Team tier users from hiding branding on personal workspaces", async () => {
    const personalOrg = {
      ...baseOrganization(),
      type: OrganizationType.PERSONAL,
    };

    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      organizations: [personalOrg],
      currentOrganization: personalOrg,
      role: OrganizationRoles.OWNER,
      isSelfServiceOrBase: false,
      userOrganizations: [],
      canSeeAllBookings: true,
      canSeeAllCustody: true,
      canUseBarcodes: false,
    } as any);

    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      firstName: "Carlos",
      tierId: "tier_2", // Team tier
      userOrganizations: [],
    });

    const result = await loader(
      createLoaderArgs({
        context: mockContext,
        request: new Request("http://localhost/settings/general"),
        params: {},
      })
    );

    // Even though tier allows hiding, workspace-tier mismatch prevents it
    expect(result).toEqual(
      expect.objectContaining({
        canHideShelfBranding: false,
      })
    );
  });

  it("allows Plus tier users to hide branding on personal workspaces", async () => {
    const personalOrg = {
      ...baseOrganization(),
      type: OrganizationType.PERSONAL,
    };

    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      organizations: [personalOrg],
      currentOrganization: personalOrg,
      role: OrganizationRoles.OWNER,
      isSelfServiceOrBase: false,
      userOrganizations: [],
      canSeeAllBookings: true,
      canSeeAllCustody: true,
      canUseBarcodes: false,
    } as any);

    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      firstName: "Carlos",
      tierId: "tier_1", // Plus tier
      userOrganizations: [],
    });

    const result = await loader(
      createLoaderArgs({
        context: mockContext,
        request: new Request("http://localhost/settings/general"),
        params: {},
      })
    );

    // Plus tier on personal workspace = allowed
    expect(result).toEqual(
      expect.objectContaining({
        canHideShelfBranding: true,
      })
    );
  });

  it("allows Team tier users to hide branding on team workspaces", async () => {
    // baseOrganization() defaults to TEAM type
    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      firstName: "Carlos",
      tierId: "tier_2", // Team tier
      userOrganizations: [],
    });

    const result = await loader(
      createLoaderArgs({
        context: mockContext,
        request: new Request("http://localhost/settings/general"),
        params: {},
      })
    );

    // Team tier on team workspace = allowed
    expect(result).toEqual(
      expect.objectContaining({
        canHideShelfBranding: true,
      })
    );
  });
});

describe("settings.general action", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: baseOrganization(),
      role: OrganizationRoles.OWNER,
      organizations: [baseOrganization()],
      isSelfServiceOrBase: false,
      userOrganizations: [],
      canSeeAllBookings: true,
      canSeeAllCustody: true,
      canUseBarcodes: false,
    } as any);

    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      tierId: "tier_2",
    });

    getOrganizationTierLimitMock.mockResolvedValue({
      id: "tier_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      canImportAssets: true,
      canExportAssets: true,
      canImportNRM: true,
      canHideShelfBranding: false,
      maxCustomFields: 0,
      maxOrganizations: 1,
    } as any);
    canHideShelfBrandingMock.mockReturnValue(false);
  });

  it("forces Shelf branding to stay enabled when the tier does not allow hiding", async () => {
    const formData = new FormData();
    formData.append("intent", "general");
    formData.append("id", "org-1");
    formData.append("name", "Test Org");
    formData.append("currency", Currency.USD);
    formData.append("qrIdDisplayPreference", "QR_ID");
    formData.append("showShelfBranding", "off");

    const request = new Request("http://localhost/settings/general", {
      method: "POST",
      body: formData,
    });

    await action(
      createActionArgs({ context: mockContext, request, params: {} })
    );

    expect(canHideShelfBrandingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canHideShelfBranding: false,
      })
    );

    expect(updateOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ showShelfBranding: true })
    );
  });

  it("allows hiding branding when tier permits and toggle is off", async () => {
    // Set up tier that ALLOWS hiding
    getOrganizationTierLimitMock.mockResolvedValue({
      id: "tier_2",
      createdAt: new Date(),
      updatedAt: new Date(),
      canImportAssets: true,
      canExportAssets: true,
      canImportNRM: true,
      canHideShelfBranding: true, // ✅ Tier allows hiding
      maxCustomFields: 0,
      maxOrganizations: 1,
    } as any);
    canHideShelfBrandingMock.mockReturnValue(true);

    const formData = new FormData();
    formData.append("intent", "general");
    formData.append("id", "org-1");
    formData.append("name", "Test Org");
    formData.append("currency", Currency.USD);
    formData.append("qrIdDisplayPreference", "QR_ID");
    // Simulate unchecked switch (hidden input sends "off")
    formData.append("showShelfBranding", "off");

    const request = new Request("http://localhost/settings/general", {
      method: "POST",
      body: formData,
    });

    await action(
      createActionArgs({ context: mockContext, request, params: {} })
    );

    expect(canHideShelfBrandingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canHideShelfBranding: true,
      })
    );

    // Verify branding is actually turned OFF
    expect(updateOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ showShelfBranding: false })
    );
  });

  it("allows showing branding when tier permits and toggle is on", async () => {
    // Organization currently has branding hidden
    const orgWithBrandingOff = {
      ...baseOrganization(),
      showShelfBranding: false,
    };

    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: orgWithBrandingOff,
      role: OrganizationRoles.OWNER,
      organizations: [orgWithBrandingOff],
      isSelfServiceOrBase: false,
      userOrganizations: [],
      canSeeAllBookings: true,
      canSeeAllCustody: true,
      canUseBarcodes: false,
    } as any);

    getOrganizationTierLimitMock.mockResolvedValue({
      id: "tier_2",
      createdAt: new Date(),
      updatedAt: new Date(),
      canImportAssets: true,
      canExportAssets: true,
      canImportNRM: true,
      canHideShelfBranding: true,
      maxCustomFields: 0,
      maxOrganizations: 1,
    } as any);
    canHideShelfBrandingMock.mockReturnValue(true);

    const formData = new FormData();
    formData.append("intent", "general");
    formData.append("id", "org-1");
    formData.append("name", "Test Org");
    formData.append("currency", Currency.USD);
    formData.append("qrIdDisplayPreference", "QR_ID");
    // Simulate checked switch (sends "on", overrides hidden "off")
    formData.append("showShelfBranding", "on");

    const request = new Request("http://localhost/settings/general", {
      method: "POST",
      body: formData,
    });

    await action(
      createActionArgs({ context: mockContext, request, params: {} })
    );

    // Verify branding is turned back ON
    expect(updateOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ showShelfBranding: true })
    );
  });

  it("prevents Team tier users from hiding branding on personal workspaces via action", async () => {
    const personalOrg = {
      ...baseOrganization(),
      type: OrganizationType.PERSONAL,
    };

    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: personalOrg,
      role: OrganizationRoles.OWNER,
      organizations: [personalOrg],
      isSelfServiceOrBase: false,
      userOrganizations: [],
      canSeeAllBookings: true,
      canSeeAllCustody: true,
      canUseBarcodes: false,
    } as any);

    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      tierId: "tier_2", // Team tier
    });

    getOrganizationTierLimitMock.mockResolvedValue({
      id: "tier_2",
      createdAt: new Date(),
      updatedAt: new Date(),
      canImportAssets: true,
      canExportAssets: true,
      canImportNRM: true,
      canHideShelfBranding: true, // Tier allows it
      maxCustomFields: 0,
      maxOrganizations: 1,
    } as any);
    canHideShelfBrandingMock.mockReturnValue(true);

    const formData = new FormData();
    formData.append("intent", "general");
    formData.append("id", "org-1");
    formData.append("name", "Test Org");
    formData.append("currency", Currency.USD);
    formData.append("qrIdDisplayPreference", "QR_ID");
    formData.append("showShelfBranding", "off");

    const request = new Request("http://localhost/settings/general", {
      method: "POST",
      body: formData,
    });

    await action(
      createActionArgs({ context: mockContext, request, params: {} })
    );

    // Should force branding to stay on due to workspace-tier mismatch
    expect(updateOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ showShelfBranding: true })
    );
  });

  it("allows Plus tier users to hide branding on personal workspaces via action", async () => {
    const personalOrg = {
      ...baseOrganization(),
      type: OrganizationType.PERSONAL,
    };

    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      currentOrganization: personalOrg,
      role: OrganizationRoles.OWNER,
      organizations: [personalOrg],
      isSelfServiceOrBase: false,
      userOrganizations: [],
      canSeeAllBookings: true,
      canSeeAllCustody: true,
      canUseBarcodes: false,
    } as any);

    dbMock.user.findUniqueOrThrow.mockResolvedValue({
      tierId: "tier_1", // Plus tier
    });

    getOrganizationTierLimitMock.mockResolvedValue({
      id: "tier_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      canImportAssets: true,
      canExportAssets: true,
      canImportNRM: true,
      canHideShelfBranding: true,
      maxCustomFields: 0,
      maxOrganizations: 1,
    } as any);
    canHideShelfBrandingMock.mockReturnValue(true);

    const formData = new FormData();
    formData.append("intent", "general");
    formData.append("id", "org-1");
    formData.append("name", "Test Org");
    formData.append("currency", Currency.USD);
    formData.append("qrIdDisplayPreference", "QR_ID");
    formData.append("showShelfBranding", "off");

    const request = new Request("http://localhost/settings/general", {
      method: "POST",
      body: formData,
    });

    await action(
      createActionArgs({ context: mockContext, request, params: {} })
    );

    // Should allow hiding branding (Plus tier on personal workspace)
    expect(updateOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ showShelfBranding: false })
    );
  });
});
