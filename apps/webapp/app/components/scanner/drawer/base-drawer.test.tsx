/**
 * Behaviour tests for {@link BaseDrawer}'s expanded state.
 *
 * The drawer takes its open/closed state from the scanner's global mode:
 * the hardware-scanner mode has no viewfinder to look at, so the list is
 * what the operator needs on screen, while camera mode keeps the drawer
 * low so the viewfinder stays visible.
 *
 * On desktop the scanner mode is already active on the first render —
 * `useGlobalModeViaObserver` seeds itself from the viewport width — so the
 * initial mode has to open the drawer on its own. A reconciler that only
 * reacts to a CHANGE of mode leaves the desktop default collapsed, which
 * no unit test would notice unless it asserts the mount case specifically.
 *
 * @see {@link file://./base-drawer.tsx}
 */
import { render, screen } from "@testing-library/react";
import { useRouteLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BaseDrawer from "./base-drawer";

// why: the drawer reads the sidebar-minimised flag off the layout route's
// loader data, which has no route context in a component test.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useRouteLoaderData: vi.fn() };
});

// why: the real hook installs a MutationObserver over the live scanner's
// `data-mode` node, which does not exist here. The stub lets each test
// state the mode the drawer mounts into.
const mockUseGlobalModeViaObserver = vi.fn<() => "camera" | "scanner">();
vi.mock("~/components/scanner/code-scanner", () => ({
  useGlobalModeViaObserver: () => mockUseGlobalModeViaObserver(),
}));

/** Mounts the drawer, reporting its `expanded` state through the body. */
function renderDrawer() {
  return render(
    <BaseDrawer hasItems title="Scanned items">
      {(expanded) => <span data-testid="expanded">{String(expanded)}</span>}
    </BaseDrawer>
  );
}

describe("BaseDrawer expanded state", () => {
  beforeEach(() => {
    vi.mocked(useRouteLoaderData).mockReturnValue({ minimizedSidebar: false });
  });

  it("mounts expanded when scanner mode is already active", () => {
    mockUseGlobalModeViaObserver.mockReturnValue("scanner");

    renderDrawer();

    expect(screen.getByTestId("expanded")).toHaveTextContent("true");
  });

  it("mounts collapsed when camera mode is active, so the viewfinder stays visible", () => {
    mockUseGlobalModeViaObserver.mockReturnValue("camera");

    renderDrawer();

    expect(screen.getByTestId("expanded")).toHaveTextContent("false");
  });

  it("follows a later mode switch", () => {
    mockUseGlobalModeViaObserver.mockReturnValue("camera");
    const { rerender } = renderDrawer();

    mockUseGlobalModeViaObserver.mockReturnValue("scanner");
    rerender(
      <BaseDrawer hasItems title="Scanned items">
        {(expanded) => <span data-testid="expanded">{String(expanded)}</span>}
      </BaseDrawer>
    );

    expect(screen.getByTestId("expanded")).toHaveTextContent("true");
  });
});
