/**
 * Sidebar provider: compact-viewport behaviour.
 *
 * Between 768px and 1279px the expanded sidebar leaves too little room for the
 * page, so the provider collapses it whatever the saved preference says, and a
 * toggle there is temporary (never written to the preference cookie).
 *
 * @see {@link file://./sidebar.tsx}
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "./sidebar";

/** Prints the provider state and exposes its toggle. */
function Probe() {
  const { state, toggleSidebar } = useSidebar();
  return (
    <>
      <output data-testid="state">{state}</output>
      <button type="button" onClick={toggleSidebar}>
        toggle
      </button>
    </>
  );
}

/**
 * Renders the provider in a router with a stubbed preference endpoint.
 *
 * @param viewportWidth - Window width the media queries are evaluated against
 * @returns The spy that records preference writes
 */
function renderSidebar(viewportWidth: number) {
  window.innerWidth = viewportWidth;
  window.dispatchEvent(new Event("resize"));

  const persistPreference = vi.fn(() => null);
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <SidebarProvider defaultOpen>
          <Probe />
        </SidebarProvider>
      ),
    },
    { path: "/api/user/prefs/minimized-sidebar", action: persistPreference },
  ]);
  render(<Stub initialEntries={["/"]} />);
  return { persistPreference };
}

/** Lets the 300ms debounced preference write fire, if one was scheduled. */
async function flushPersistDebounce() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
}

describe("SidebarProvider on a compact viewport", () => {
  afterEach(() => {
    window.innerWidth = 1024;
  });

  it("collapses even when the saved preference is expanded", async () => {
    renderSidebar(1000);

    expect(await screen.findByTestId("state")).toHaveTextContent("collapsed");
  });

  it("opens on toggle without overwriting the saved preference", async () => {
    const { persistPreference } = renderSidebar(1000);
    await screen.findByText("collapsed");

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("state")).toHaveTextContent("expanded");

    await flushPersistDebounce();
    expect(persistPreference).not.toHaveBeenCalled();
  });

  it("keeps the saved preference and persists toggles on a wide viewport", async () => {
    const { persistPreference } = renderSidebar(1440);
    expect(await screen.findByTestId("state")).toHaveTextContent("expanded");

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("state")).toHaveTextContent("collapsed");

    await flushPersistDebounce();
    expect(persistPreference).toHaveBeenCalledTimes(1);
  });
});
