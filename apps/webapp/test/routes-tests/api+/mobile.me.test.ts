/**
 * Route tests for `GET /api/mobile/me`: each workspace carries whether the
 * mobile API refuses requests in it, and an older field set stays untouched,
 * so apps that do not read the new fields keep working.
 *
 * @see {@link file://./../../../app/routes/api+/mobile+/me.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import {
  getMobileWorkspaceStates,
  getUserOrganizations,
  requireMobileAuth,
} from "~/modules/api/mobile-auth.server";
import { loader } from "~/routes/api+/mobile+/me";
import { Logger } from "~/utils/logger";
import { assertIsDataWithResponseInit } from "@helpers/assertions";

// why: the route only stitches three reads together; each read has its own
// module tests (mobile-auth.server.*.test.ts), and loading the real module
// connects Prisma and Supabase.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  getUserOrganizations: vi.fn(),
  getMobileWorkspaceStates: vi.fn(),
}));

// why: the fallback path logs; the test asserts that it does without
// writing to the test output.
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

const USER = { id: "user-1", email: "test@example.com" };

/** An organization as `getUserOrganizations` returns it. */
function org(id: string) {
  return { id, name: id, type: "TEAM", roles: ["ADMIN"] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: USER,
    authUser: {},
  } as never);
  vi.mocked(getUserOrganizations).mockResolvedValue({
    organizations: [org("team-active"), org("team-lapsed")],
    lastSelectedOrganizationId: "team-lapsed",
  } as never);
});

describe("GET /api/mobile/me", () => {
  it("adds each workspace's active state beside its existing fields, in the same order", async () => {
    vi.mocked(getMobileWorkspaceStates).mockResolvedValue(
      new Map([
        [
          "team-active",
          { inactive: false, inactiveReason: null, inactiveMessage: null },
        ],
        [
          "team-lapsed",
          {
            inactive: true,
            inactiveReason: "lapsed",
            inactiveMessage: "This workspace is inactive.",
          },
        ],
      ])
    );

    const response = await loader(
      createLoaderArgs({
        request: new Request("http://localhost:3000/api/mobile/me"),
      })
    );

    assertIsDataWithResponseInit(response);
    expect(response.data).toEqual({
      user: USER,
      organizations: [
        {
          ...org("team-active"),
          inactive: false,
          inactiveReason: null,
          inactiveMessage: null,
        },
        {
          ...org("team-lapsed"),
          inactive: true,
          inactiveReason: "lapsed",
          inactiveMessage: "This workspace is inactive.",
        },
      ],
      // The server keeps its landing choice; the app skips an inactive one.
      lastSelectedOrganizationId: "team-lapsed",
    });
    expect(getMobileWorkspaceStates).toHaveBeenCalledWith({
      userId: "user-1",
      organizationIds: ["team-active", "team-lapsed"],
    });
  });

  it("reports a workspace the state read left out as active", async () => {
    vi.mocked(getMobileWorkspaceStates).mockResolvedValue(new Map());

    const response = await loader(
      createLoaderArgs({
        request: new Request("http://localhost:3000/api/mobile/me"),
      })
    );

    assertIsDataWithResponseInit(response);
    expect(
      (response.data as { organizations: { inactive: boolean }[] })
        .organizations
    ).toEqual([
      expect.objectContaining({ id: "team-active", inactive: false }),
      expect.objectContaining({ id: "team-lapsed", inactive: false }),
    ]);
  });

  it("still answers when the state read fails, reporting every workspace active", async () => {
    vi.mocked(getMobileWorkspaceStates).mockRejectedValue(
      new Error("connection reset")
    );

    const response = await loader(
      createLoaderArgs({
        request: new Request("http://localhost:3000/api/mobile/me"),
      })
    );

    assertIsDataWithResponseInit(response);
    expect(response.init?.status ?? 200).toBe(200);
    expect(
      (response.data as { organizations: { inactive: boolean }[] })
        .organizations
    ).toEqual([
      expect.objectContaining({ id: "team-active", inactive: false }),
      expect.objectContaining({ id: "team-lapsed", inactive: false }),
    ]);
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });
});
