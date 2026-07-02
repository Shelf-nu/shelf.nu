import { action } from "~/routes/api+/mobile+/tags.create";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
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
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: external service — we don't want to hit the real database when creating tags
vi.mock("~/modules/tag/service.server", () => ({
  createTag: vi.fn(),
}));

// why: error utility — we mock to control error formatting in tests.
// badRequest must be provided too: parseData (http.server) imports it from
// this module to build its 400 validation error.
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
    message: cause?.message || "Unknown error",
    status: cause?.status || 500,
  })),
  badRequest: vi.fn((message: string, options: any) =>
    Object.assign(new Error(message), { ...options, status: 400 })
  ),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createTag } from "~/modules/tag/service.server";

const ORG_ID = "org-1";
const USER = { id: "user-1" };

function makeRequest(body: unknown) {
  return new Request(
    `https://app.test/api/mobile/tags/create?orgId=${ORG_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/mobile/tags/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireMobileAuth as any).mockResolvedValue({ user: USER });
    (requireOrganizationAccess as any).mockResolvedValue(ORG_ID);
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (createTag as any).mockResolvedValue({
      id: "tag-1",
      name: "Fragile",
      color: "#175CD3",
    });
  });

  it("creates an org-scoped, all-purpose tag and returns its picker shape", async () => {
    const response = (await action(
      createActionArgs({ request: makeRequest({ name: "  Fragile  " }) })
    )) as unknown as Response;

    expect(createTag).toHaveBeenCalledWith(
      expect.objectContaining({
        // Zod trims before the service sees it.
        name: "Fragile",
        organizationId: ORG_ID,
        userId: USER.id,
        // All-purpose default — usable on assets AND bookings (web parity).
        useFor: [],
        color: expect.stringMatching(/^#[0-9a-fA-F]{6}$/),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      tag: { id: "tag-1", name: "Fragile" },
    });
  });

  it("enforces the tag.create permission before touching the service", async () => {
    (requireMobilePermission as any).mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 })
    );

    const response = (await action(
      createActionArgs({ request: makeRequest({ name: "Fragile" }) })
    )) as unknown as Response;

    expect(response.status).toBe(403);
    expect(createTag).not.toHaveBeenCalled();
  });

  it("rejects names shorter than 3 chars as a 400 (web NewTagFormSchema parity)", async () => {
    const response = (await action(
      createActionArgs({ request: makeRequest({ name: "ab" }) })
    )) as unknown as Response;

    // parseData maps validation failures to a 400 client error, not a 500.
    expect(response.status).toBe(400);
    expect(createTag).not.toHaveBeenCalled();
  });

  it("surfaces duplicate-name errors from the service as a client error", async () => {
    (createTag as any).mockRejectedValue(
      Object.assign(new Error("Tag with that name already exists"), {
        status: 400,
      })
    );

    const response = (await action(
      createActionArgs({ request: makeRequest({ name: "Fragile" }) })
    )) as unknown as Response;

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { message: "Tag with that name already exists" },
    });
  });
});
