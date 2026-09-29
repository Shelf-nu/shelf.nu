// @vitest-environment node

/**
 * Plan page loader: reads the plan intent onboarding hands over as
 * `?plan=team&trial=…`, and nothing else changes for everyone else.
 *
 * @see {@link file://./../../../app/routes/_welcome+/select-plan.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAuditAddonPrices } from "~/modules/audit/addon.server";
import { getBarcodeAddonPrices } from "~/modules/barcode/addon.server";
import { getUserByID } from "~/modules/user/service.server";
import { loader } from "~/routes/_welcome+/select-plan";
import { requirePermission } from "~/utils/roles.server";
import {
  getStripeCustomer,
  getStripePricesForTrialPlanSelection,
} from "~/utils/stripe.server";

// why: preventing Prisma from trying to connect to a real database during tests
vi.mock("~/database/db.server", () => ({ db: {} }));
// why: the loader's Stripe reads are network calls; the test is about the
// query string, so they return empty price lists.
vi.mock("~/utils/stripe.server", () => ({
  getStripeCustomer: vi.fn(),
  getStripePricesForTrialPlanSelection: vi.fn(),
}));
// why: the add-on price lookups are Stripe calls as well
vi.mock("~/modules/audit/addon.server", () => ({
  getAuditAddonPrices: vi.fn(),
}));
vi.mock("~/modules/barcode/addon.server", () => ({
  getBarcodeAddonPrices: vi.fn(),
}));
// why: the loader only needs a user with no Stripe customer; no database here
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));
// why: the permission gate is not under test here
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: mocking Remix's data() so the loader result is a readable Response
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

function load(url: string) {
  return loader({
    request: new Request(url),
    context: { getSession: () => ({ userId: "user-123" }) },
    params: {},
  } as unknown as LoaderFunctionArgs) as unknown as Promise<Response>;
}

describe("select-plan loader — the plan intent handed over by onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({} as never);
    vi.mocked(getUserByID).mockResolvedValue({
      id: "user-123",
      customerId: null,
    } as never);
    vi.mocked(getStripeCustomer).mockResolvedValue(null as never);
    vi.mocked(getStripePricesForTrialPlanSelection).mockResolvedValue(
      [] as never
    );
    vi.mocked(getAuditAddonPrices).mockResolvedValue({
      month: null,
      year: null,
    } as never);
    vi.mocked(getBarcodeAddonPrices).mockResolvedValue({
      month: null,
      year: null,
    } as never);
  });

  it("reads a Team trial intent", async () => {
    const response = await load(
      "http://localhost:3000/select-plan?plan=team&trial=true"
    );

    expect(response.status).toBe(200);
    expect((await response.json()).planIntent).toEqual({
      plan: "team",
      trial: true,
    });
  });

  it("reads a Team intent without a trial as trial=false", async () => {
    const response = await load("http://localhost:3000/select-plan?plan=team");

    expect((await response.json()).planIntent).toEqual({
      plan: "team",
      trial: false,
    });
  });

  it("has no plan intent for a visit from the Personal/Team question", async () => {
    const response = await load(
      "http://localhost:3000/select-plan?withAudits=true"
    );

    expect((await response.json()).planIntent).toBeNull();
  });

  it("ignores a plan it does not know", async () => {
    const response = await load(
      "http://localhost:3000/select-plan?plan=gold&trial=true"
    );

    expect((await response.json()).planIntent).toBeNull();
  });
});
