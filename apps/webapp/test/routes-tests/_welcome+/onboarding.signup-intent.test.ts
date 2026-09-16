// @vitest-environment node

/**
 * Onboarding is where the signup link's intent is consumed: stored on the
 * business-intel record for attribution, used to skip the Personal/Team
 * question for a Team intent, and cleared. Invited users are unaffected.
 *
 * The premium-features-off branch of the destination is pinned by the pure
 * helper's own test (`resolveOnboardingDestination`); here premium is on.
 *
 * @see {@link file://./../../../app/routes/_welcome+/onboarding.tsx}
 * @see {@link file://./../../../app/modules/signup-intent/schema.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { signInWithEmail } from "~/modules/auth/service.server";
import { upsertBusinessIntel } from "~/modules/business-intel/service.server";
import { getOrganizationById } from "~/modules/organization/service.server";
import { serializeSignupIntent } from "~/modules/signup-intent/cookie.server";
import { getUserByID, updateUser } from "~/modules/user/service.server";
import { action } from "~/routes/_welcome+/onboarding";
import { createStripeCustomer } from "~/utils/stripe.server";

// why: preventing Prisma from trying to connect to a real database during tests
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: mocking Remix's data() so error results are readable Responses
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: the attribution write only happens when business intel is collected;
// pin it on so the test sees the write, and keep the welcome email off.
vi.mock("~/config/shelf.config", () => ({
  config: {
    collectBusinessIntel: true,
    sendOnboardingEmail: false,
  },
}));

// why: the account update and the attribution write are the sinks under
// test; neither should touch a database here.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
  updateUser: vi.fn(),
}));
vi.mock("~/modules/business-intel/service.server", () => ({
  upsertBusinessIntel: vi.fn(),
}));
// why: the invited-user branch resolves the workspace name; no database here.
vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationById: vi.fn(),
}));
// why: preventing Stripe and Supabase calls during the test
vi.mock("~/utils/stripe.server", () => ({
  createStripeCustomer: vi.fn(),
}));
vi.mock("~/modules/auth/service.server", () => ({
  signInWithEmail: vi.fn(),
  getAuthUserById: vi.fn(),
}));
// why: only the workspace cookie's presence matters, not its encoding
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi
    .fn()
    .mockResolvedValue("selected-organization-id=org-123"),
}));

const USER = {
  id: "user-123",
  email: "jane@example.com",
  firstName: "Jane",
  lastName: "Doe",
  createdWithInvite: false,
  onboarded: false,
  userOrganizations: [],
};

const context = {
  getSession: () => ({ userId: USER.id }),
  setSession: vi.fn(),
} as unknown as ActionFunctionArgs["context"];

const TEAM_TRIAL_INTENT = {
  plan: "team" as const,
  trial: true,
  utmSource: "website",
  utmMedium: "pricing",
  utmCampaign: "launch",
  utmContent: "hero",
};

async function intentCookie(
  intent: Parameters<typeof serializeSignupIntent>[0]
) {
  return (await serializeSignupIntent(intent)).split(";")[0];
}

function onboardingRequest({
  fields = {},
  cookie,
  urlSuffix = "",
}: {
  fields?: Record<string, string>;
  cookie?: string;
  urlSuffix?: string;
} = {}) {
  const body = new URLSearchParams({
    username: "jane",
    firstName: USER.firstName,
    lastName: USER.lastName,
    userSignedUpWithPassword: "true",
    jobTitle: "Operations Manager",
    teamSize: "Small team (2-10)",
    companyName: "Acme",
    referralSource: "Google search",
    ...fields,
  });
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
  });
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return new Request(`http://localhost:3000/onboarding${urlSuffix}`, {
    method: "POST",
    headers,
    body,
  });
}

function submit(request: Request) {
  return action(
    createActionArgs({ context, request, params: {} })
  ) as Promise<Response>;
}

/** The `signup-intent` Set-Cookie a response carries, or undefined. */
function signupIntentCookieSetBy(response: Response) {
  return response.headers
    .getSetCookie()
    .find((value) => value.startsWith("signup-intent="));
}

describe("onboarding action — consuming the signup intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserByID).mockResolvedValue(USER as never);
    vi.mocked(updateUser).mockResolvedValue({
      ...USER,
      customerId: "cust_123",
    } as never);
    vi.mocked(getOrganizationById).mockResolvedValue({
      id: "org-123",
      name: "Acme Corporation",
    } as never);
    vi.mocked(upsertBusinessIntel).mockResolvedValue({} as never);
    vi.mocked(createStripeCustomer).mockResolvedValue({} as never);
    vi.mocked(signInWithEmail).mockResolvedValue(null);
  });

  it("skips the Personal/Team question for a Team trial and clears the cookie", async () => {
    const response = await submit(
      onboardingRequest({ cookie: await intentCookie(TEAM_TRIAL_INTENT) })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/select-plan?plan=team&trial=true"
    );
    expect(signupIntentCookieSetBy(response)).toContain("Max-Age=0");
  });

  it("stores the plan intent and the campaign on the business-intel record", async () => {
    await submit(
      onboardingRequest({ cookie: await intentCookie(TEAM_TRIAL_INTENT) })
    );

    expect(upsertBusinessIntel).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER.id,
        teamSize: "Small team (2-10)",
        signupPlan: "team",
        signupTrial: true,
        utmSource: "website",
        utmMedium: "pricing",
        utmCampaign: "launch",
        utmContent: "hero",
      })
    );
  });

  it("leads with subscribing for a Team intent without a trial", async () => {
    const response = await submit(
      onboardingRequest({ cookie: await intentCookie({ plan: "team" }) })
    );

    expect(response.headers.get("Location")).toBe("/select-plan?plan=team");
  });

  it("keeps the Personal/Team question, and stores nothing extra, without an intent", async () => {
    const response = await submit(onboardingRequest());

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/welcome");
    expect(signupIntentCookieSetBy(response)).toBeUndefined();
    expect(upsertBusinessIntel).toHaveBeenCalledWith(
      expect.objectContaining({
        signupPlan: undefined,
        signupTrial: undefined,
        utmSource: undefined,
      })
    );
  });

  it("keeps the Personal/Team question for a campaign-only intent, but records the campaign", async () => {
    const response = await submit(
      onboardingRequest({
        cookie: await intentCookie({ utmSource: "newsletter" }),
      })
    );

    expect(response.headers.get("Location")).toBe("/welcome");
    expect(signupIntentCookieSetBy(response)).toContain("Max-Age=0");
    expect(upsertBusinessIntel).toHaveBeenCalledWith(
      expect.objectContaining({
        utmSource: "newsletter",
        signupPlan: undefined,
      })
    );
  });

  it("sends an invited user to their workspace whatever the link said", async () => {
    vi.mocked(getUserByID).mockResolvedValue({
      ...USER,
      createdWithInvite: true,
      userOrganizations: [{ organizationId: "org-123" }],
    } as never);

    const response = await submit(
      onboardingRequest({
        fields: {
          teamSize: "",
          companyName: "",
          organizationId: "org-123",
        },
        urlSuffix: "?organizationId=org-123",
        cookie: await intentCookie(TEAM_TRIAL_INTENT),
      })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/assets");
    expect(response.headers.getSetCookie()).toContain(
      "selected-organization-id=org-123"
    );
    expect(signupIntentCookieSetBy(response)).toContain("Max-Age=0");
  });

  it("leaves the cookie in place when the form is rejected, so the retry still carries it", async () => {
    const response = await submit(
      onboardingRequest({
        fields: { jobTitle: "   " },
        cookie: await intentCookie(TEAM_TRIAL_INTENT),
      })
    );

    expect(response.status).toBe(400);
    expect(updateUser).not.toHaveBeenCalled();
    expect(upsertBusinessIntel).not.toHaveBeenCalled();
    expect(signupIntentCookieSetBy(response)).toBeUndefined();
  });
});
