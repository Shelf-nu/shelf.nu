import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListContent } from "./kits._index";

// why: provide stable Link implementation without requiring router context
vi.mock("@remix-run/react", async () => {
  const actual = (await vi.importActual("@remix-run/react")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

// why: prevent Prisma client initialization during isolated layout test
vi.mock("~/database/db.server", () => ({
  db: {
    teamMember: { findMany: vi.fn(), count: vi.fn() },
  },
}));

// why: layout-focused test shouldn't depend on Remix fetcher behavior
vi.mock("~/components/kits/kit-image", () => ({
  default: ({
    kit,
    className,
  }: {
    kit: { alt: string };
    className?: string;
  }) => (
    <div data-testid="kit-image" className={className}>
      <img alt={kit.alt} />
    </div>
  ),
}));

// why: simplify layout test by omitting badge rendering details
vi.mock("~/components/assets/category-badge", () => ({
  CategoryBadge: ({ children }: { children?: ReactNode }) => (
    <span data-testid="category-badge">{children}</span>
  ),
}));

// why: avoid Tag implementation details unrelated to layout assertions
vi.mock("~/components/shared/tag", () => ({
  Tag: ({ children }: { children?: ReactNode }) => (
    <span data-testid="location-tag">{children}</span>
  ),
}));

// why: keep focus on layout by removing dependency on badge rendering
vi.mock("~/components/kits/kit-status-badge", () => ({
  KitStatusBadge: ({ children }: { children?: ReactNode }) => (
    <span data-testid="status-badge">{children}</span>
  ),
}));

// why: layout assertions don't rely on team member badge internals
vi.mock("~/components/user/team-member-badge", () => ({
  TeamMemberBadge: ({ children }: { children?: ReactNode }) => (
    <span data-testid="team-member-badge">{children}</span>
  ),
}));

// why: simplify action cell rendering for layout checks
vi.mock("~/components/kits/kit-quick-actions", () => ({
  default: () => <div data-testid="quick-actions" />,
}));

describe("kits index list row layout", () => {
  const longDescription =
    "This portable production kit includes everything needed for on-location shoots. ".repeat(
      5
    );

  it("maintains thumbnail sizing and wraps description for narrow viewports", () => {
    render(
      <table>
        <tbody>
          <tr>
            <ListContent
              item={{
                id: "kit_1",
                name: "Production Kit",
                description: longDescription,
                image: null,
                imageExpiration: null,
                status: "AVAILABLE",
                assets: [
                  { id: "asset_1", availableToBook: true, status: "AVAILABLE" },
                ],
                category: { id: "category_1", name: "Cameras", color: "#000000" },
                location: { id: "location_1", name: "Studio" } as any,
                qrCodes: [],
                custody: { custodian: null },
                _count: { assets: 1 },
              }}
            />
          </tr>
        </tbody>
      </table>
    );

    const image = screen.getByRole("img", { name: "Production Kit" });
    const thumbnailWrapper = image.closest("div")?.parentElement as HTMLElement;
    expect(thumbnailWrapper).toHaveClass("size-12");
    expect(thumbnailWrapper).toHaveClass("shrink-0");

    const descriptionCell = screen
      .getAllByRole("cell")
      .find((cell) =>
        cell.textContent?.includes("This portable production kit")
      ) as HTMLTableCellElement;

    expect(descriptionCell).toHaveClass("min-w-0");
    expect(descriptionCell).toHaveClass("break-words");
    expect(descriptionCell.className).not.toMatch(/md:max-w/);

    const descriptionParagraph = descriptionCell.querySelector("p");
    expect(descriptionParagraph).toHaveClass("w-full");
    expect(descriptionParagraph).toHaveClass("md:w-60");

    const spans = descriptionParagraph?.querySelectorAll("span");
    expect(spans?.length).toBe(3);
    expect(spans?.[spans.length - 1]?.textContent?.endsWith("...")).toBe(true);
  });
});
