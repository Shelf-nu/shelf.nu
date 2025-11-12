// @vitest-environment node

import type { ActionFunctionArgs } from "react-router";

import { describe, expect, it, beforeEach, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((data: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(data), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("@react-router/node", async () => {
  const actual = await vi.importActual("@remix-run/node");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: ensuring consistent validation behavior across test environments
vi.mock("~/config/shelf.config", () => ({
  config: {
    collectBusinessIntel: true,
    sendOnboardingEmail: false,
  },
}));

// why: testing form validation logic without executing actual user/org updates
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
  updateUser: vi.fn(),
}));

// why: verifying invited user flow checks organization membership
vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationById: vi.fn(),
}));

// why: avoiding database calls for business intelligence data collection
vi.mock("~/modules/business-intel/service.server", () => ({
  upsertBusinessIntel: vi.fn(),
}));

// why: preventing actual Stripe API calls during test
vi.mock("~/utils/stripe.server", () => ({
  createStripeCustomer: vi.fn(),
}));

// why: preventing auth service from hitting database when setting password
vi.mock("~/modules/auth/service.server", () => ({
  signInWithEmail: vi.fn(),
  getAuthUserById: vi.fn(),
}));

const { action } = await import("../../app/routes/_welcome+/onboarding");
const { getUserByID, updateUser } = await import(
  "~/modules/user/service.server"
);
const { getOrganizationById } = await import(
  "~/modules/organization/service.server"
);
const { upsertBusinessIntel } = await import(
  "~/modules/business-intel/service.server"
);
const { createStripeCustomer } = await import("~/utils/stripe.server");
const { signInWithEmail } = await import("~/modules/auth/service.server");

function createRequestBody(entries: Record<string, string | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === "string") {
      params.append(key, value);
    }
  }

  return params;
}

describe("onboarding action validation", () => {
  const baseUser = {
    id: "user-123",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Doe",
    createdWithInvite: false,
    onboarded: false,
    companyName: null,
  } as any;

  const context = {
    getSession: () => ({ userId: baseUser.id }),
    setSession: vi.fn(),
  } as unknown as ActionFunctionArgs["context"];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getUserByID).mockResolvedValue(baseUser);
    vi.mocked(updateUser).mockResolvedValue({
      ...baseUser,
      customerId: "cust_123",
    });
    vi.mocked(getOrganizationById).mockResolvedValue({
      id: "org-123",
      name: "Acme Corporation",
    } as any);
    vi.mocked(upsertBusinessIntel).mockResolvedValue({
      id: "bi-123",
      userId: baseUser.id,
      howDidYouHearAboutUs: null,
      jobTitle: null,
      teamSize: null,
      companyName: null,
      primaryUseCase: null,
      currentSolution: null,
      timeline: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(createStripeCustomer).mockResolvedValue({} as any);
    vi.mocked(signInWithEmail).mockResolvedValue(null);
  });

  function buildRequest(
    fields: Record<string, string>,
    { urlSuffix = "" }: { urlSuffix?: string } = {}
  ) {
    const body = createRequestBody({
      username: "jane", // satisfies schema but not relevant
      firstName: baseUser.firstName,
      lastName: baseUser.lastName,
      password: "password123",
      confirmPassword: "password123",
      userSignedUpWithPassword: "true",
      jobTitle: "Project Manager",
      teamSize: "Just me (1)",
      companyName: "Acme",
      referralSource: "Google search",
      ...fields,
    });

    return new Request(`https://example.com/welcome${urlSuffix}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  it("rejects whitespace-only job titles", async () => {
    const request = buildRequest({ jobTitle: "   " });

    const response = (await action(
      createActionArgs({
        context,
        request,
        params: {},
      })
    )) as Response;

    expect(response.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("requires a verified company for self-serve users even if an organizationId is forged", async () => {
    const request = buildRequest(
      {
        companyName: "   ",
        organizationId: "fake-org", // forged invite
      },
      { urlSuffix: "?organizationId=fake-org" }
    );

    const response = (await action(
      createActionArgs({
        context,
        request,
        params: {},
      })
    )) as Response;

    expect(response.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("allows Personal use without teamSize and companyName", async () => {
    const request = buildRequest({
      jobTitle: "Personal use",
      teamSize: "",
      companyName: "",
      referralSource: "Google search",
    });

    const response = (await action(
      createActionArgs({
        context,
        request,
        params: {},
      })
    )) as Response;

    expect(response.status).toBe(302);
    expect(updateUser).toHaveBeenCalled();
  });

  it("requires teamSize and companyName for non-Personal use roles", async () => {
    const request = buildRequest({
      jobTitle: "IT Administrator",
      teamSize: "",
      companyName: "",
      referralSource: "Google search",
    });

    const response = (await action(
      createActionArgs({
        context,
        request,
        params: {},
      })
    )) as Response;

    expect(response.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("allows invited users to skip teamSize even for non-Personal roles", async () => {
    // Setup: user has a verified organization membership
    const invitedUser = {
      ...baseUser,
      createdWithInvite: true,
      userOrganizations: [{ organizationId: "org-123" }],
    };

    vi.mocked(getUserByID).mockResolvedValue(invitedUser);

    const request = buildRequest(
      {
        jobTitle: "IT Administrator",
        teamSize: "",
        companyName: "",
        referralSource: "Google search",
        organizationId: "org-123",
      },
      { urlSuffix: "?organizationId=org-123" }
    );

    const response = (await action(
      createActionArgs({
        context,
        request,
        params: {},
      })
    )) as Response;

    expect(response.status).toBe(302);
    expect(updateUser).toHaveBeenCalled();
  });
});
