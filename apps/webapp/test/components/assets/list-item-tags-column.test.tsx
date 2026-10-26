import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";

const viewer = vi.hoisted(() => ({ roles: ["ADMIN"] as string[] }));

// why: the tag links read the viewer's roles from Remix loader data, which is
// unavailable outside a route. The roles still go through the real matrix.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => viewer.roles,
}));

const createTag = (id: number) => ({
  id: `tag-${id}`,
  name: `Tag ${id}`,
  color: "#ff0000",
});

describe("ListItemTagsColumn", () => {
  beforeEach(() => {
    viewer.roles = ["ADMIN"];
  });

  it("reveals overflow tags inside the tooltip", async () => {
    const tags = [1, 2, 3, 4, 5].map(createTag);

    render(<ListItemTagsColumn tags={tags} />);

    expect(screen.getByText("Tag 1")).toBeInTheDocument();
    expect(screen.getByText("Tag 2")).toBeInTheDocument();
    expect(screen.queryByText("Tag 3")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.hover(screen.getByText("+3"));

    expect(await screen.findAllByText("Tag 3")).not.toHaveLength(0);
    expect(await screen.findAllByText("Tag 4")).not.toHaveLength(0);
    expect(await screen.findAllByText("Tag 5")).not.toHaveLength(0);
  });

  it("does not render a view more badge when there are two or fewer tags", () => {
    const tags = [1, 2].map(createTag);

    render(<ListItemTagsColumn tags={tags} />);

    expect(screen.queryByText(/\+/)).not.toBeInTheDocument();
  });
  it("links every tag, overflow included, to the assets carrying it", async () => {
    const tags = [1, 2, 3].map(createTag);

    render(
      <MemoryRouter>
        <ListItemTagsColumn tags={tags} linkToAssets />
      </MemoryRouter>
    );

    expect(screen.getByText("Tag 1").closest("a")?.getAttribute("href")).toBe(
      "/assets?tag=tag-1"
    );

    const user = userEvent.setup();
    await user.hover(screen.getByText("+1"));

    const [overflowTag] = await screen.findAllByText("Tag 3");
    expect(overflowTag.closest("a")?.getAttribute("href")).toBe(
      "/assets?tag=tag-3"
    );
  });

  it("lets a keyboard user open the overflow and focus its tag links", async () => {
    const tags = [1, 2, 3].map(createTag);

    render(
      <MemoryRouter>
        <ListItemTagsColumn tags={tags} linkToAssets />
      </MemoryRouter>
    );

    const user = userEvent.setup();
    await user.tab(); // Tag 1
    await user.tab(); // Tag 2
    await user.tab(); // "+1"
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Show 1 more" })
    );

    await user.keyboard("{Enter}");
    const overflowLink = await screen.findByRole("link", { name: /Tag 3/ });
    await user.tab();

    expect(document.activeElement).toBe(overflowLink);
    expect(overflowLink.getAttribute("href")).toBe("/assets?tag=tag-3");
  });

  it("renders plain tags for a viewer who may not read assets", () => {
    viewer.roles = [];

    render(
      <MemoryRouter>
        <ListItemTagsColumn tags={[createTag(1)]} linkToAssets />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
