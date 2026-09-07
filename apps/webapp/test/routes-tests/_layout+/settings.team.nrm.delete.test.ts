/**
 * Route tests for the NRM delete action.
 *
 * The confirmation dialog swaps the submit button for an explanation once a
 * member holds custody, so the only requests that reach this action are ones
 * the client believed were allowed. That belief can be wrong — the list page
 * was rendered before custody was assigned, or the request never came from the
 * page at all — which is why the refusal has to live on the server.
 *
 * These pin the wiring: the action delegates to the service that enforces the
 * rule, and a refusal reaches the user as the message written for them rather
 * than as a generic failure.
 *
 * @see {@link file://../../../app/routes/_layout+/settings.team.nrm.tsx}
 * @see {@link file://../../../app/modules/team-member/delete-nrm.test.ts} the rule itself
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";
import { deleteNRM } from "~/modules/team-member/service.server";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

const ORG = "org-1";

// why: the action's job here is delegation, not authorization — run it without
// executing a real permission check.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: importing the route reaches `db.server`, which constructs the Prisma
// client and connects at module scope — leaving an unhandled connection error
// in the run. Nothing under test touches a delegate, so an empty client is
// enough to keep the import side-effect off a database.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the service owns the custody rule and is tested directly next to it.
// Stubbing it lets these tests state "the delete was refused" without seeding
// custody rows, and makes the payload the route forwards observable.
vi.mock("~/modules/team-member/service.server", () => ({
  deleteNRM: vi.fn(),
}));

const { action } = await import("~/routes/_layout+/settings.team.nrm");

const requirePermissionMock = vi.mocked(requirePermission);
const deleteNRMMock = vi.mocked(deleteNRM);

/**
 * Posts a delete for `teamMemberId`.
 *
 * why: a `URLSearchParams` body rather than `FormData` — happy-dom drops empty
 * fields when a `FormData` round-trips through `Request`, which silently
 * changes what the action parses.
 */
function submitDelete(teamMemberId: string) {
  const body = new URLSearchParams({ intent: "delete", teamMemberId });

  return action(
    createActionArgs({
      request: new Request("http://localhost:3000/settings/team/nrm", {
        method: "POST",
        body,
      }),
      context: {
        getSession: () => ({ userId: "user-1" }),
      } as never,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({ organizationId: ORG } as never);
  deleteNRMMock.mockResolvedValue(undefined);
});

describe("settings.team.nrm delete action", () => {
  it("routes the delete through the service that enforces the custody rule", async () => {
    await submitDelete("nrm-1");

    // The write has to stay in the service: the rule it carries is a predicate
    // on the same statement, which a route issuing its own update cannot
    // express.
    expect(deleteNRMMock).toHaveBeenCalledWith({
      nrmId: "nrm-1",
      organizationId: ORG,
    });
  });

  it("scopes the delete to the caller's organization, not the submitted form", async () => {
    await submitDelete("nrm-1");

    const [{ organizationId }] = deleteNRMMock.mock.calls[0];
    expect(organizationId).toBe(ORG);
  });

  it("returns the refusal to the user instead of a generic failure", async () => {
    deleteNRMMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "This team member has custody over some assets. Please release custody or check-in those assets before deleting the user.",
        label: "Team Member",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = await submitDelete("nrm-1");

    assertIsDataWithResponseInit(response);
    expect(response.init?.status).toBe(400);
    expect(JSON.stringify(response.data)).toMatch(/custody/i);
  });

  it("redirects back to the index when the delete succeeds", async () => {
    const response = await submitDelete("nrm-1");

    expect(response).toMatchObject({ status: 302 });
  });
});
