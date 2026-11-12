/**
 * Tests for remembered list filters: a list's links carry the filters it last
 * rendered with in this tab, so its loader does not redirect to restore them.
 *
 * @see {@link file://./use-remembered-list-href.ts}
 */
import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { Provider } from "jotai";
import { MemoryRouter, useNavigate } from "react-router";
import { describe, expect, it, vi } from "vitest";
import {
  filteredListPathOf,
  useRememberedListHref,
  useRememberListFilters,
  withRememberedFilters,
} from "./use-remembered-list-href";

/** The workspace the hook reads, per test. */
const workspace = vi.hoisted(() => ({ id: "org-1" as string | undefined }));

// why: the current workspace comes from the layout loader's data, which needs
// a data router; the cases only need its id.
vi.mock("./use-current-organization", () => ({
  useCurrentOrganization: () =>
    workspace.id ? { id: workspace.id } : undefined,
}));

describe("filteredListPathOf", () => {
  it("recognises the lists that remember their filters", () => {
    expect(filteredListPathOf("/assets")).toBe("/assets");
    expect(filteredListPathOf("/bookings")).toBe("/bookings");
    expect(filteredListPathOf("/kits/")).toBe("/kits");
  });

  it("ignores every other page, including pages under a list", () => {
    expect(filteredListPathOf("/assets/new")).toBeNull();
    expect(filteredListPathOf("/locations")).toBeNull();
    expect(filteredListPathOf("/")).toBeNull();
  });
});

describe("withRememberedFilters", () => {
  const remembered = { "org-1:/assets": "category=is%3Auncategorized" };

  it("adds a list's remembered filters to its bare link", () => {
    expect(withRememberedFilters("/assets", remembered, "org-1")).toBe(
      "/assets?category=is%3Auncategorized"
    );
  });

  it("keeps each workspace's filters to itself", () => {
    expect(withRememberedFilters("/assets", remembered, "org-2")).toBe(
      "/assets"
    );
  });

  it("leaves other links, and links that already carry a query, alone", () => {
    expect(withRememberedFilters("/settings", remembered, "org-1")).toBe(
      "/settings"
    );
    expect(
      withRememberedFilters("/assets?status=AVAILABLE", remembered, "org-1")
    ).toBe("/assets?status=AVAILABLE");
  });

  it("keeps the bare path for a list remembered without filters", () => {
    expect(withRememberedFilters("/kits", { "org-1:/kits": "" }, "org-1")).toBe(
      "/kits"
    );
  });
});

describe("useRememberListFilters", () => {
  /** Renders the watcher and a link resolver inside one router and store. */
  function renderApp(initialEntry: string) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider>
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      </Provider>
    );
    return renderHook(
      () => {
        useRememberListFilters();
        return { href: useRememberedListHref(), navigate: useNavigate() };
      },
      { wrapper }
    );
  }

  it("links back to the filters a list rendered with, without page or search", () => {
    workspace.id = "org-1";
    const { result } = renderApp(
      "/assets?category=is%3Auncategorized&page=3&s=laptop"
    );

    act(() => void result.current.navigate("/bookings"));

    expect(result.current.href("/assets")).toBe(
      "/assets?category=is%3Auncategorized"
    );
    expect(result.current.href("/bookings")).toBe("/bookings");
  });

  it("follows the filters as they change on the list", () => {
    workspace.id = "org-1";
    const { result } = renderApp("/kits?status=AVAILABLE");

    act(() => void result.current.navigate("/kits?status=IN_CUSTODY"));

    expect(result.current.href("/kits")).toBe("/kits?status=IN_CUSTODY");
  });

  it("keeps the bare link for a list not visited yet", () => {
    workspace.id = "org-1";
    const { result } = renderApp("/home");

    expect(result.current.href("/assets")).toBe("/assets");
  });
});
