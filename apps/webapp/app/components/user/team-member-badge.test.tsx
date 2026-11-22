/**
 * TeamMemberBadge naming and link tests.
 *
 * The badge is the shared custodian chip for the assets index, kits index,
 * bookings index, locations lists, calendar cards and audit asset lists — so
 * whatever it decides to call someone, it decides in all of those places at
 * once. These tests pin the naming precedence, which no page-level test can
 * see: every wrong answer is still a real, plausible name. The link tests pin
 * which page the chip opens for each kind of viewer.
 *
 * @see {@link file://./team-member-badge.tsx}
 * @see {@link file://./../../utils/user.ts} — `resolveTeamMemberName`
 */
import type { ReactElement } from "react";
import { render as rtlRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({ roles: ["ADMIN"] as string[] }));

// why: the badge reads the viewer's roles, org and identity from Remix loader
// data, which is unavailable outside a route. Stub them to a viewer who may
// see this custodian, so these tests exercise naming and the link target,
// not the custody visibility gate. The roles go through the real matrix.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => viewer.roles,
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

/** Renders inside a router, which the badge's link needs. */
function render(ui: ReactElement) {
  return rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
}

beforeEach(() => {
  viewer.roles = ["ADMIN"];
});

describe("TeamMemberBadge", () => {
  it("shows the display name when the user has one", () => {
    render(
      <TeamMemberBadge
        teamMember={{
          id: "tm-1",
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
          id: "tm-1",
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
          id: "tm-1",
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
        teamMember={{ id: "tm-1", name: "External Contractor", user: null }}
      />
    );

    expect(screen.getByText("External Contractor")).toBeTruthy();
  });

  it("renders nothing without a team member", () => {
    const { container } = render(<TeamMemberBadge teamMember={null} />);

    expect(container.textContent).toBe("");
  });
  describe("links to what the person holds", () => {
    const registered = {
      id: "tm-1",
      name: "Kim Mohnacs",
      user: {
        id: "u1",
        displayName: null,
        firstName: "Kim",
        lastName: "Mohnacs",
      },
    };

    it("opens the team member page for a viewer who may see it", () => {
      render(<TeamMemberBadge teamMember={registered} />);

      expect(screen.getByRole("link").getAttribute("href")).toBe(
        "/settings/team/users/u1/assets"
      );
    });

    it("opens the custody-filtered asset index for a non-registered member", () => {
      render(
        <TeamMemberBadge
          teamMember={{ id: "tm-2", name: "External Contractor", user: null }}
        />
      );

      expect(screen.getByRole("link").getAttribute("href")).toBe(
        "/assets?teamMember=tm-2"
      );
    });

    it("opens the asset index for a viewer without team member pages", () => {
      viewer.roles = ["SELF_SERVICE"];

      render(<TeamMemberBadge teamMember={registered} />);

      expect(screen.getByRole("link").getAttribute("href")).toBe(
        "/assets?teamMember=tm-1"
      );
    });

    it("stays plain when there is nowhere the viewer may go", () => {
      viewer.roles = ["SELF_SERVICE"];

      render(<TeamMemberBadge teamMember={{ ...registered, id: null }} />);

      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("Kim Mohnacs")).toBeTruthy();
    });

    it("opens the member's bookings page when linking to bookings", () => {
      render(<TeamMemberBadge teamMember={registered} linkTo="bookings" />);

      expect(screen.getByRole("link").getAttribute("href")).toBe(
        "/settings/team/users/u1/bookings"
      );
    });

    it("opens the custodian-filtered bookings list for a non-registered member", () => {
      render(
        <TeamMemberBadge
          teamMember={{ id: "tm-2", name: "External Contractor", user: null }}
          linkTo="bookings"
        />
      );

      expect(screen.getByRole("link").getAttribute("href")).toBe(
        "/bookings?teamMember=tm-2"
      );
    });

    it("stays plain where it cannot be clicked", () => {
      render(<TeamMemberBadge teamMember={registered} linkTo="none" />);

      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("Kim Mohnacs")).toBeTruthy();
    });
  });
});
