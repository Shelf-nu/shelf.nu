import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/bookings.new";
import { requirePermission } from "~/utils/roles.server";

const dbMocks = vi.hoisted(() => {
  return {
    booking: {
      create: vi.fn(),
    },
  };
});

const teamMemberServiceMocks = vi.hoisted(() => ({
  getTeamMember: vi.fn(),
}));

// why: testing route handler without executing actual database operations
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      create: dbMocks.booking.create,
    },
  },
}));

// why: testing authorization logic without executing actual permission checks
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: testing booking creation validation without executing actual booking service operations
vi.mock("~/modules/booking/service.server", () => ({
  createBooking: vi.fn().mockResolvedValue({
    id: "booking-123",
    from: new Date("2024-01-01T10:00:00Z"),
    to: new Date("2024-01-02T10:00:00Z"),
  }),
}));

// why: testing custodian organization validation without database lookups
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: teamMemberServiceMocks.getTeamMember,
}));

// why: testing booking creation without executing tag building logic
vi.mock("~/modules/tag/service.server", () => ({
  buildTagsSet: vi.fn().mockReturnValue({ set: [] }),
}));

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: controlling form data parsing and response formatting for predictable test behavior
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

// why: testing booking creation without fetching actual booking settings
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({}),
}));

// why: testing booking creation without fetching actual working hours
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn().mockResolvedValue({}),
}));

// why: controlling timezone for consistent booking time handling
vi.mock("~/utils/client-hints", () => ({
  getHints: vi.fn(() => ({ timeZone: "UTC" })),
  getClientHint: vi.fn(() => ({ timeZone: "UTC" })),
}));

// why: preventing actual cookie operations during route tests
vi.mock("~/utils/cookies.server", () => ({
  setCookie: vi.fn(),
}));

// why: preventing actual organization cookie setting during route tests
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("cookie"),
}));

// why: mocking redirect and json response helpers for testing route handler status codes
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
const mockGetTeamMember = teamMemberServiceMocks.getTeamMember;
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
  mockGetTeamMember.mockReset();
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
    mockGetTeamMember.mockRejectedValue(new Error("Not found"));

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

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "foreign-team-member-123",
      organizationId: "org-1",
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
    mockGetTeamMember.mockResolvedValue({
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

    expect(mockGetTeamMember).toHaveBeenCalledWith({
      id: "team-member-123",
      organizationId: "org-1",
      select: { id: true, userId: true },
    });
  });

  it("redirects scan intent to the booking overview scan assets page", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.ADMIN,
      isSelfServiceOrBase: false,
    } as any);

    mockGetTeamMember.mockResolvedValue({
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
    formData.set("intent", "scan");

    const request = new Request("https://example.com/bookings/new", {
      method: "POST",
      body: formData,
    });

    const response = await action(createActionArgs({ request }));

    expect(response.status).toBe(302);
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(
      "/bookings/booking-123/overview/scan-assets"
    );
  });

  it("prevents self-service users from assigning booking to other team members", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      role: OrganizationRoles.SELF_SERVICE,
      isSelfServiceOrBase: true,
    } as any);

    // Valid team member from same org, but different user
    mockGetTeamMember.mockResolvedValue({
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
    mockGetTeamMember.mockResolvedValue({
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
    mockGetTeamMember.mockResolvedValue({
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
