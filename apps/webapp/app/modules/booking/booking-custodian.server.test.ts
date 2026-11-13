/**
 * Behaviour of `resolveBookingCustodian` when the team member lookup fails:
 * a missing team member is the caller's mistake, a database failure is ours.
 *
 * @see {@link file://./booking-custodian.server.ts}
 */
import { describe, expect, it, vi } from "vitest";

import { getTeamMember } from "~/modules/team-member/service.server";
import { ShelfError } from "~/utils/error";

import { resolveBookingCustodian } from "./booking-custodian.server";

// why: the lookup is the database read whose failure modes are under test
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vi.fn(),
}));

/** Arguments for one lookup; the error paths fail before the role check. */
const args = {
  custodianTeamMemberId: "tm-1",
  organizationId: "org-1",
  userId: "user-1",
  access: { policy: {} } as Parameters<
    typeof resolveBookingCustodian
  >[0]["access"],
};

describe("resolveBookingCustodian", () => {
  it("returns the team member and its linked user", async () => {
    vi.mocked(getTeamMember).mockResolvedValueOnce({
      id: "tm-1",
      userId: "user-2",
    } as Awaited<ReturnType<typeof getTeamMember>>);

    await expect(
      resolveBookingCustodian({ ...args, currentCustodianTeamMemberId: "tm-1" })
    ).resolves.toEqual({ id: "tm-1", userId: "user-2" });
  });

  it("answers 404 without reporting it when the team member is not in the workspace", async () => {
    vi.mocked(getTeamMember).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "Team member not found",
        label: "Team Member",
        status: 404,
        shouldBeCaptured: false,
      })
    );

    await expect(resolveBookingCustodian(args)).rejects.toMatchObject({
      status: 404,
      shouldBeCaptured: false,
    });
  });

  it("reports a database failure as a 500 instead of a missing team member", async () => {
    vi.mocked(getTeamMember).mockRejectedValueOnce(
      new ShelfError({
        cause: new Error("connection timeout"),
        message: "Team member not found",
        label: "Team Member",
        status: 404,
        shouldBeCaptured: true,
      })
    );

    await expect(resolveBookingCustodian(args)).rejects.toMatchObject({
      status: 500,
      shouldBeCaptured: true,
      title: "Unable to load team member",
    });
  });
});
