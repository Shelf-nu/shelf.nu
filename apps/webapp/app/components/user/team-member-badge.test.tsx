/**
 * TeamMemberBadge naming tests.
 *
 * The badge is the shared custodian chip for the assets index, kits index,
 * bookings index, locations lists, calendar cards and audit asset lists — so
 * whatever it decides to call someone, it decides in all of those places at
 * once. These tests pin the naming precedence, which no page-level test can
 * see: every wrong answer is still a real, plausible name.
 *
 * @see {@link file://./team-member-badge.tsx}
 * @see {@link file://./../../utils/user.ts} — `resolveTeamMemberName`
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// why: the badge reads the viewer's roles, org and identity from Remix loader
// data, which is unavailable outside a route. Stub them to a permitted viewer
// so these tests exercise naming, not the custody permission gate.
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({ roles: ["ADMIN"] }),
}));
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => ({ id: "org-1" }),
}));
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "viewer-1" }),
}));
vi.mock(
  "~/utils/permissions/custody-and-bookings-permissions.validator.client",
  () => ({ userCanViewSpecificCustody: () => true })
);

import { TeamMemberBadge } from "./team-member-badge";

describe("TeamMemberBadge", () => {
  it("shows the display name when the user has one", () => {
    render(
      <TeamMemberBadge
        teamMember={{
          name: "Robert Mohnacs",
          user: {
            id: "u1",
            displayName: "Bobbie Mohnacs",
            firstName: "Robert",
            lastName: "Mohnacs",
          },
        }}
      />
    );

    expect(screen.getByText("Bobbie Mohnacs")).toBeTruthy();
    expect(screen.queryByText("Robert Mohnacs")).toBeNull();
  });

  it("prefers the display name over a disagreeing TeamMember.name", () => {
    // `TeamMember.name` is a mirror of the user's name, refreshed when the
    // profile changes. A stale mirror must not outrank the live display name.
    render(
      <TeamMemberBadge
        teamMember={{
          name: "Stale Legal Name",
          user: {
            id: "u1",
            displayName: "Chosen Name",
            firstName: "Stale",
            lastName: "Legal Name",
          },
        }}
      />
    );

    expect(screen.getByText("Chosen Name")).toBeTruthy();
  });

  it("falls back to first + last name when no display name is set", () => {
    render(
      <TeamMemberBadge
        teamMember={{
          name: "ignored",
          user: {
            id: "u1",
            displayName: null,
            firstName: "Kim",
            lastName: "Mohnacs",
          },
        }}
      />
    );

    expect(screen.getByText("Kim Mohnacs")).toBeTruthy();
  });

  it("names a non-registered member by the stored TeamMember.name", () => {
    // An NRM has no user account, so the stored name is the only name there is.
    render(
      <TeamMemberBadge
        teamMember={{ name: "External Contractor", user: null }}
      />
    );

    expect(screen.getByText("External Contractor")).toBeTruthy();
  });

  it("renders nothing without a team member", () => {
    const { container } = render(<TeamMemberBadge teamMember={null} />);

    expect(container.textContent).toBe("");
  });
});
