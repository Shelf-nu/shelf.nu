import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/bookings.new";
import { requirePermission } from "~/utils/roles.server";

const dbMocks = vi.hoisted(() => {
  return {
    teamMember: {
      findFirst: vi.fn(),
    },
    booking: {
      create: vi.fn(),
    },
  };
});

vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: {
      findFirst: dbMocks.teamMember.findFirst,
    },
    booking: {
      create: dbMocks.booking.create,
    },
  },
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/modules/booking/service.server", () => ({
  createBooking: vi.fn().mockResolvedValue({
    id: "booking-123",
    from: new Date("2024-01-01T10:00:00Z"),
    to: new Date("2024-01-02T10:00:00Z"),
  }),
}));

vi.mock("~/modules/tag/service.server", () => ({
  buildTagsSet: vi.fn().mockReturnValue({ set: [] }),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

vi.mock("~/utils/http.server", () => ({
  assertIsPost: vi.fn(),
  parseData: vi.fn().mockImplementation((formData) => {
    const name = formData.get("name");
    const custodian = JSON.parse(formData.get("custodian") || "{}");
    return {
      name,
      custodian,
      assetIds: [],
      description: null,
      tags: "",
    };
  }),
  data: vi.fn((x) => ({ success: true, ...x })),
  error: vi.fn((x) => ({ error: x })),
  getCurrentSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn().mockResolvedValue({}),
}));

vi.mock("~/utils/client-hints", () => ({
  getHints: vi.fn(() => ({ timeZone: "UTC" })),
  getClientHint: vi.fn(() => ({ timeZone: "UTC" })),
}));

vi.mock("~/utils/cookies.server", () => ({
  setCookie: vi.fn(),
}));

vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("cookie"),
}));

vi.mock("@remix-run/node", async () => {
  const actual = await vi.importActual("@remix-run/node");
  return {
    ...actual,
    redirect: vi.fn(() => new Response(null, { status: 302 })),
    json: vi.fn(
      (data, init) =>
        new Response(JSON.stringify(data), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);
const mockTeamMemberFindFirst = dbMocks.teamMember.findFirst;
const mockBookingCreate = dbMocks.booking.create;

function createActionArgs(
  overrides: Partial<ActionFunctionArgs> = {}
): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    request: new Request("https://example.com/bookings/new", {
      method: "POST",
    }),
    params: {},
    ...overrides,
  } as ActionFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTeamMemberFindFirst.mockReset();
  mockBookingCreate.mockReset();
  requirePermissionMock.mockReset();
});

describe("bookings/new - custodian assignment", () => {
  it("prevents assigning booking to custodians from different organizations", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      isSelfServiceOrBase: false,
    } as any);

    // Custodian not found due to org filter
    mockTeamMemberFindFirst.mockResolvedValue(null);

    const formData = new FormData();
    formData.set("name", "Test Booking");
    formData.set("startDate", "2024-01-01T10:00");
    formData.set("endDate", "2024-01-02T10:00");
    formData.set(
      "custodian",
      JSON.stringify({
        id: "foreign-team-member-123",
        name: "Foreign Team Member",
      })
    );

    const request = new Request("https://example.com/bookings/new", {
      method: "POST",
      body: formData,
    });

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(404);

    expect(mockTeamMemberFindFirst).toHaveBeenCalledWith({
      where: {
        id: "foreign-team-member-123",
        organizationId: "org-1",
      },
      select: { id: true, userId: true },
    });

    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it("allows assigning booking to custodians from the same organization", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      isSelfServiceOrBase: false,
    } as any);

    // Valid team member from same org
    mockTeamMemberFindFirst.mockResolvedValue({
      id: "team-member-123",
      userId: "user-456",
    });

    const formData = new FormData();
    formData.set("name", "Test Booking");
    formData.set("startDate", "2024-01-01T10:00");
    formData.set("endDate", "2024-01-02T10:00");
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-123",
        name: "Valid Team Member",
      })
    );

    const request = new Request("https://example.com/bookings/new", {
      method: "POST",
      body: formData,
    });

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(302); // Redirect on success

    expect(mockTeamMemberFindFirst).toHaveBeenCalledWith({
      where: {
        id: "team-member-123",
        organizationId: "org-1",
      },
      select: { id: true, userId: true },
    });
  });

  it("prevents self-service users from assigning booking to other team members", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    // Valid team member from same org, but different user
    mockTeamMemberFindFirst.mockResolvedValue({
      id: "team-member-456",
      userId: "other-user-456", // Different from current user
    });

    const formData = new FormData();
    formData.set("name", "Test Booking");
    formData.set("startDate", "2024-01-01T10:00");
    formData.set("endDate", "2024-01-02T10:00");
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-456",
        name: "Other Team Member",
      })
    );

    const request = new Request("https://example.com/bookings/new", {
      method: "POST",
      body: formData,
    });

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(500); // ShelfError defaults to 500

    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it("allows self-service users to assign booking to themselves", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    // Valid team member from same org, same user
    mockTeamMemberFindFirst.mockResolvedValue({
      id: "team-member-123",
      userId: "user-123", // Same as current user
    });

    const formData = new FormData();
    formData.set("name", "Test Booking");
    formData.set("startDate", "2024-01-01T10:00");
    formData.set("endDate", "2024-01-02T10:00");
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-123",
        name: "Self User",
      })
    );

    const request = new Request("https://example.com/bookings/new", {
      method: "POST",
      body: formData,
    });

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(302); // Redirect on success
  });

  it("allows BASE role users to assign booking to themselves only", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.BASE,
      isSelfServiceOrBase: true,
    } as any);

    // Valid team member from same org, but different user (should fail for BASE role)
    mockTeamMemberFindFirst.mockResolvedValue({
      id: "team-member-456",
      userId: "other-user-456", // Different from current user
    });

    const formData = new FormData();
    formData.set("name", "Test Booking");
    formData.set("startDate", "2024-01-01T10:00");
    formData.set("endDate", "2024-01-02T10:00");
    formData.set(
      "custodian",
      JSON.stringify({
        id: "team-member-456",
        name: "Other Team Member",
      })
    );

    const request = new Request("https://example.com/bookings/new", {
      method: "POST",
      body: formData,
    });

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(500); // ShelfError for self-assignment restriction

    expect(mockBookingCreate).not.toHaveBeenCalled();
  });
});
