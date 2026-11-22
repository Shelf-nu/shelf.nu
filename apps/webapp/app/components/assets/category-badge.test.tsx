/**
 * CategoryBadge link tests.
 *
 * Pins where a category chip leads, including the "Uncategorized" chip, and
 * that it stays plain for a viewer who may not read assets or where links are
 * not wanted.
 *
 * @see {@link file://./category-badge.tsx}
 * @see {@link file://./assets-filter-link.tsx}
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({ roles: ["ADMIN"] as string[] }));

// why: the link reads the viewer's roles from Remix loader data, which is
// unavailable outside a route. The roles still go through the real matrix.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => viewer.roles,
}));

import { CategoryBadge } from "./category-badge";

const category = { id: "cat-1", name: "Laptops", color: "#123456" };

describe("CategoryBadge", () => {
  beforeEach(() => {
    viewer.roles = ["ADMIN"];
  });

  it("opens the assets in its category", () => {
    render(
      <MemoryRouter>
        <CategoryBadge category={category} linkToAssets />
      </MemoryRouter>
    );

    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/assets?category=cat-1"
    );
  });

  it("opens the assets without a category from the Uncategorized chip", () => {
    render(
      <MemoryRouter>
        <CategoryBadge category={null} linkToAssets />
      </MemoryRouter>
    );

    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/assets?category=uncategorized"
    );
  });

  it("stays plain for a viewer who may not read assets", () => {
    viewer.roles = [];

    render(
      <MemoryRouter>
        <CategoryBadge category={category} linkToAssets />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Laptops")).toBeTruthy();
  });

  it("stays plain without linkToAssets", () => {
    render(<CategoryBadge category={category} />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
