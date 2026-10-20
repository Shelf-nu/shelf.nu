/**
 * Tests for {@link UnlockReportsPage}, the reports index a workspace sees when
 * its plan does not include reports.
 *
 * The page has one job per viewer: the owner, who pays for the plan, gets the
 * way to upgrade; everyone else is told who can. Both see every report the
 * plan would unlock.
 *
 * @see {@link file://./unlock-reports-page.tsx}
 * @see {@link file://../../routes/_layout+/reports._index.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { getEnabledReports } from "~/modules/reports/registry";

import { UnlockReportsPage } from "./unlock-reports-page";

/** Renders with the real react-router Link, so the Upgrade href is the real one. */
function renderPage({ isOwner }: { isOwner: boolean }) {
  return render(
    <MemoryRouter>
      <UnlockReportsPage reports={getEnabledReports()} isOwner={isOwner} />
    </MemoryRouter>
  );
}

describe("UnlockReportsPage", () => {
  it("says reports are part of Plus and Team and lists every report", () => {
    renderPage({ isOwner: true });

    expect(
      screen.getByRole("heading", { name: "Reports are part of Plus and Team" })
    ).toBeInTheDocument();

    for (const report of getEnabledReports()) {
      expect(screen.getByText(report.title)).toBeInTheDocument();
      expect(screen.getByText(report.description)).toBeInTheDocument();
    }
  });

  it("groups the reports under their category", () => {
    renderPage({ isOwner: true });

    const bookings = screen.getByRole("heading", { name: "Bookings" })
      .parentElement as HTMLElement;
    expect(
      within(bookings).getByText("Booking Compliance")
    ).toBeInTheDocument();
    expect(within(bookings).queryByText("Custody Snapshot")).toBeNull();
  });

  it("offers the owner the upgrade", () => {
    renderPage({ isOwner: true });

    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
      "href",
      "/account-details/subscription"
    );
    expect(
      screen.queryByText("Ask the workspace owner to upgrade.")
    ).toBeNull();
  });

  it("tells everyone else to ask the owner", () => {
    renderPage({ isOwner: false });

    expect(
      screen.getByText("Ask the workspace owner to upgrade.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
  });

  it("says the asset list stays on every plan, for every viewer", () => {
    for (const isOwner of [true, false]) {
      const { unmount } = renderPage({ isOwner });
      expect(
        screen.getByText(
          "Your asset list, filters and counts stay available on every plan."
        )
      ).toBeInTheDocument();
      unmount();
    }
  });
});
