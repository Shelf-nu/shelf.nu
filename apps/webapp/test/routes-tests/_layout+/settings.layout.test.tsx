/**
 * Tests for the settings layout component (`routes/_layout+/settings.tsx`).
 *
 * The layout makes every settings tab linkable: an anchored card's title gets
 * a copy-link button, and opening a link brings the card into view. These
 * tests render the layout around a stand-in tab, so they fail if either
 * `SectionLinksProvider` or `useSectionHashSync` is dropped from it.
 *
 * Mocks:
 * - `~/components/layout/header`: the page header needs the command palette
 *   and app layout data, none of which the layout's linking depends on.
 *
 * @see {@link file://./../../../app/routes/_layout+/settings.tsx}
 */
import { act, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Card, CardTitle } from "~/components/shared/card";
import { TooltipProvider } from "~/components/shared/tooltip";
import SettingsPage from "~/routes/_layout+/settings";

// why: the real header renders the command palette button and breadcrumbs,
// which need app-level providers and layout data unrelated to linking.
vi.mock("~/components/layout/header", () => ({
  default: () => <header>Settings</header>,
}));

const scrolledTo: string[] = [];

function BookingsTab() {
  return (
    <Card id="automation">
      <CardTitle>Automation</CardTitle>
    </Card>
  );
}

/** Renders the settings layout at `url` inside the app's scroll area. */
async function openSettings(url: string) {
  const main = document.createElement("main");
  main.id = "main-content";
  document.body.appendChild(main);

  const Stub = createRoutesStub([
    {
      path: "/settings",
      Component: SettingsPage,
      loader: () => ({
        header: { title: "Settings" },
        tabs: [{ to: "bookings", content: "Bookings" }],
      }),
      children: [{ path: "bookings", Component: BookingsTab }],
    },
  ]);

  render(
    <TooltipProvider>
      <Stub initialEntries={[url]} />
    </TooltipProvider>,
    { container: main }
  );
  await screen.findByRole("heading", { name: "Automation" });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

beforeEach(() => {
  // why: happy-dom does not scroll; recording the call is how the test sees
  // which card was brought into view.
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element
  ) {
    scrolledTo.push(this.id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  scrolledTo.length = 0;
});

describe("settings layout", () => {
  it("gives every anchored card title a copy-link button", async () => {
    await openSettings("/settings/bookings");

    expect(
      screen.getByRole("button", { name: "Copy link to Automation" })
    ).toBeInTheDocument();
  });

  it("opens a card link at the card", async () => {
    await openSettings("/settings/bookings#automation");

    expect(scrolledTo).toContain("automation");
    expect(document.activeElement).toBe(document.getElementById("automation"));
  });
});
