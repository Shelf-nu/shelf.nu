import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";

const createTag = (id: number) => ({
  id: `tag-${id}`,
  name: `Tag ${id}`,
});

describe("ListItemTagsColumn", () => {
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
});
