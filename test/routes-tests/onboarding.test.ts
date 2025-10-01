// @vitest-environment node

import type { ActionFunctionArgs } from "@remix-run/node";

import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("~/config/shelf.config", () => ({
  config: {
    showHowDidYouFindUs: false,
    collectBusinessIntel: true,
    sendOnboardingEmail: false,
  },
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationById: vi.fn(),
}));

vi.mock("~/modules/business-intel/service.server", () => ({
  upsertBusinessIntel: vi.fn(),
}));

vi.mock("~/modules/auth/service.server", () => ({
  signInWithEmail: vi.fn(),
  getAuthUserById: vi.fn(),
}));

vi.mock("~/utils/stripe.server", () => ({
  createStripeCustomer: vi.fn(),
}));

vi.mock("~/utils/cookies.server", () => ({
  setCookie: vi.fn(),
}));

vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn(),
}));

vi.mock("~/emails/mail.server", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("~/emails/onboarding-email", () => ({
  onboardingEmailText: vi.fn(),
}));

vi.mock("~/utils/env", () => ({
  SMTP_FROM: "",
  SENTRY_DSN: "",
  NODE_ENV: "test",
}));

const onboardingModule = await import("../../app/routes/_welcome+/onboarding");
const userModule = await import("~/modules/user/service.server");
const businessIntelModule = await import(
  "~/modules/business-intel/service.server"
);
const organizationContextModule = await import(
  "~/modules/organization/context.server"
);
const cookiesModule = await import("~/utils/cookies.server");
const stripeModule = await import("~/utils/stripe.server");
const mailModule = await import("~/emails/mail.server");

const organizationModule = await import(
  "~/modules/organization/service.server"
);

const { action } = onboardingModule;
const { getUserByID, updateUser } = userModule;
const { upsertBusinessIntel } = businessIntelModule;
const { setSelectedOrganizationIdCookie } = organizationContextModule;
const { setCookie } = cookiesModule;
const { createStripeCustomer } = stripeModule;
const { sendEmail } = mailModule;
const { getOrganizationById } = organizationModule;

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
    vi.mocked(getOrganizationById).mockResolvedValue({
      id: "org-123",
      name: "Acme Corporation",
    } as any);
    vi.mocked(setSelectedOrganizationIdCookie).mockResolvedValue("cookie");
    vi.mocked(setCookie).mockReturnValue(["set-cookie", "cookie=value"]);
    vi.mocked(createStripeCustomer).mockResolvedValue({} as any);
    vi.mocked(sendEmail).mockResolvedValue();
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

    const response = (await action({
      context,
      request,
      params: {},
    })) as Response;

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

    const response = (await action({
      context,
      request,
      params: {},
    })) as Response;

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

    const response = (await action({
      context,
      request,
      params: {},
    })) as Response;

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

    const response = (await action({
      context,
      request,
      params: {},
    })) as Response;

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

    const response = (await action({
      context,
      request,
      params: {},
    })) as Response;

    expect(response.status).toBe(302);
    expect(updateUser).toHaveBeenCalled();
  });
});
