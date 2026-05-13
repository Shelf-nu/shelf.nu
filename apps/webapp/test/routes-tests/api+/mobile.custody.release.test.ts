import { action } from "~/routes/api+/mobile+/custody.release";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vitest.hoisted(() => {
  return () =>
    vitest.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vitest.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vitest.fn(),
  requireOrganizationAccess: vitest.fn(),
  requireMobilePermission: vitest.fn(),
}));

// why: PR #2533 reads the current custody record before calling
// `releaseCustody` so it can attach `teamMemberId` + `targetUserId` to the
// `CUSTODY_RELEASED` activity event. Without a mock here the test reaches
// real Prisma and the call rejects with `P1001 Can't reach database`,
// turning `body.asset` into `undefined`.
vitest.mock("~/database/db.server", () => ({
  db: {
    custody: {
      findFirst: vitest.fn(),
    },
  },
}));

// why: external service — we mock custody release without hitting the database
vitest.mock("~/modules/custody/service.server", () => ({
  releaseCustody: vitest.fn(),
}));

// why: external service — we mock note creation without hitting the database
vitest.mock("~/modules/note/service.server", () => ({
  createNote: vitest.fn().mockResolvedValue(undefined),
}));

// why: external utility — we mock the user link wrapper to avoid markdown processing
vitest.mock("~/utils/markdoc-wrappers", () => ({
  wrapUserLinkForNote: vitest.fn(
    ({ firstName, lastName }: any) => `**${firstName} ${lastName}**`
  ),
}));

// why: we need to control error formatting without running real error logic
vitest.mock("~/utils/error", () => ({
  makeShelfError: vitest.fn((cause: any) => ({
    message: cause?.message || "Unknown error",
    status: cause?.status || 500,
  })),
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
  requireOrganizationAccess,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import { releaseCustody } from "~/modules/custody/service.server";
import { createNote } from "~/modules/note/service.server";
import { db } from "~/database/db.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
  profilePicture: null,
  onboarded: true,
};

function createCustodyReleaseRequest(
  body: Record<string, unknown>,
  orgId = "org-1"
) {
  return new Request(
    `http://localhost/api/mobile/custody/release?orgId=${orgId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token",
      },
      body: JSON.stringify(body),
    }
  );
}

describe("POST /api/mobile/custody/release", () => {
  beforeEach(() => {
    vitest.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });

    (requireOrganizationAccess as any).mockResolvedValue("org-1");

    (requireMobilePermission as any).mockResolvedValue(undefined);

    (releaseCustody as any).mockResolvedValue({
      id: "asset-1",
      title: "Test Laptop",
      status: "AVAILABLE",
    });

    // why: PR #2533 reads the current custody record before calling
    // `releaseCustody` so it can attribute the `CUSTODY_RELEASED` event
    // to the team member who held the asset (and the user behind that
    // team member, if any).
    (db.custody.findFirst as any).mockResolvedValue({
      custodian: {
        id: "team-member-1",
        user: { id: "user-2" },
      },
    });
  });

  it("should release custody successfully and create a note", async () => {
    const request = createCustodyReleaseRequest({ assetId: "asset-1" });

    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.asset).toBeDefined();
    expect(body.asset.id).toBe("asset-1");

    // PR #2533 threads the `activityEvent` payload through so
    // `releaseCustody` records `CUSTODY_RELEASED` in the same tx as the
    // mutation, with actor + previous custodian attribution.
    expect(releaseCustody).toHaveBeenCalledWith({
      assetId: "asset-1",
      organizationId: "org-1",
      activityEvent: {
        actorUserId: "user-1",
        teamMemberId: "team-member-1",
        targetUserId: "user-2",
      },
    });

    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE",
        userId: "user-1",
        assetId: "asset-1",
      })
    );
  });

  it("should return error when permission is denied", async () => {
    const permError = new Error("Permission denied");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const request = createCustodyReleaseRequest({ assetId: "asset-1" });

    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toContain("Permission denied");
  });
});
