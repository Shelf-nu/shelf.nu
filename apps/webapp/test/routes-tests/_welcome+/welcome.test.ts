// @vitest-environment node

/**
 * Welcome route: SSO accounts are kept out of add-on onboarding. The loader
 * redirects them before any Stripe price lookup, and the action refuses them
 * through the purchase gate before any trial is claimed.
 *
 * @see {@link file://./../../../app/routes/_welcome+/welcome.tsx}
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { getAuditAddonPrices } from "~/modules/audit/addon.server";
import { getBarcodeAddonPrices } from "~/modules/barcode/addon.server";
import { claimAddonTrial } from "~/modules/billing/addon-trial-claim.server";
import { assertUserMayPurchase } from "~/modules/billing/sso-purchase-gate.server";
import { getUserByID } from "~/modules/user/service.server";
import { action, loader } from "~/routes/_welcome+/welcome";
import { ShelfError } from "~/utils/error";
import { getOrCreateCustomerId } from "~/utils/stripe.server";

// why: preventing Prisma from trying to connect to a real database during tests
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findFirstOrThrow: vi.fn(), findUnique: vi.fn() },
  },
}));
// why: the premium branch is made explicit, independent of the ambient env
vi.mock("~/utils/env", async () => {
  const actual =
    await vi.importActual<typeof import("~/utils/env")>("~/utils/env");
  return { ...actual, ENABLE_PREMIUM_FEATURES: true };
});
// why: the add-on price lookups are Stripe calls
vi.mock("~/modules/audit/addon.server", () => ({
  getAuditAddonPrices: vi.fn(),
  createAuditAddonTrialSubscription: vi.fn(),
}));
vi.mock("~/modules/barcode/addon.server", () => ({
  getBarcodeAddonPrices: vi.fn(),
  createBarcodeAddonTrialSubscription: vi.fn(),
}));
// why: claiming a trial writes to the database; the test only asserts it is
// never reached. The pure helper keeps its real behavior.
vi.mock("~/modules/billing/addon-trial-claim.server", async () => {
  const actual = await vi.importActual<
    typeof import("~/modules/billing/addon-trial-claim.server")
  >("~/modules/billing/addon-trial-claim.server");
  return { ...actual, claimAddonTrial: vi.fn(), releaseAddonTrial: vi.fn() };
});
// why: the gate queries the database; its rule is covered in its own tests.
// Only `assertUserMayPurchase` is replaced, the pure rule stays real.
vi.mock("~/modules/billing/sso-purchase-gate.server", async () => {
  const actual = await vi.importActual<
    typeof import("~/modules/billing/sso-purchase-gate.server")
  >("~/modules/billing/sso-purchase-gate.server");
  return { ...actual, assertUserMayPurchase: vi.fn() };
});
// why: no database; the loader reads the user and business intel through it
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));
// why: the personal workspace lookup is a database read
vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationByUserId: vi.fn().mockResolvedValue({ id: "org-personal" }),
}));
// why: creating a Stripe customer is a network call
vi.mock("~/utils/stripe.server", () => ({
  getOrCreateCustomerId: vi.fn(),
}));
// why: the trial welcome emails are outbound mail
vi.mock("~/emails/stripe/audit-trial-welcome", () => ({
  sendAuditTrialWelcomeEmail: vi.fn(),
}));
vi.mock("~/emails/stripe/barcode-trial-welcome", () => ({
  sendBarcodeTrialWelcomeEmail: vi.fn(),
}));

// why: mocking Remix's data() so route results are readable Responses
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

const context = { getSession: () => ({ userId: "user-123", email: "a@b.c" }) };

function load() {
  return loader({
    request: new Request("http://localhost:3000/welcome"),
    context,
    params: {},
  } as unknown as LoaderFunctionArgs) as unknown as Promise<Response>;
}

function submit() {
  return action({
    // URLSearchParams body: happy-dom drops FormData fields on the round-trip
    request: new Request("http://localhost:3000/welcome", {
      method: "POST",
      body: new URLSearchParams({
        intent: "personal-with-addons",
        auditPriceId: "price_audit",
      }),
    }),
    context,
    params: {},
  } as unknown as ActionFunctionArgs) as unknown as Promise<Response>;
}

describe("welcome loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuditAddonPrices).mockResolvedValue({
      month: null,
      year: null,
    } as never);
    vi.mocked(getBarcodeAddonPrices).mockResolvedValue({
      month: null,
      year: null,
    } as never);
    vi.mocked(db.organization.findUnique).mockResolvedValue(null as never);
  });

  it("redirects an SSO user home before any Stripe call", async () => {
    vi.mocked(getUserByID).mockResolvedValue({
      sso: true,
      businessIntel: null,
    } as never);

    const response = await load();

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/");
    expect(getAuditAddonPrices).not.toHaveBeenCalled();
    expect(getBarcodeAddonPrices).not.toHaveBeenCalled();
  });

  it("still serves the page to a non-SSO user", async () => {
    vi.mocked(getUserByID).mockResolvedValue({
      sso: false,
      businessIntel: null,
    } as never);

    const response = await load();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      teamIntent: null,
      usedAuditTrial: false,
    });
    expect(getAuditAddonPrices).toHaveBeenCalled();
  });
});

describe("welcome action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses with 403 before any trial, customer or workspace work", async () => {
    vi.mocked(assertUserMayPurchase).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "Billing for single sign-on accounts is managed.",
        status: 403,
        shouldBeCaptured: false,
        label: "Subscription",
      })
    );

    const response = await submit();

    expect(response.status).toBe(403);
    expect(assertUserMayPurchase).toHaveBeenCalledWith({
      userId: "user-123",
      target: "personal",
    });
    expect(claimAddonTrial).not.toHaveBeenCalled();
    expect(getOrCreateCustomerId).not.toHaveBeenCalled();
    expect(db.organization.findFirstOrThrow).not.toHaveBeenCalled();
  });
});
