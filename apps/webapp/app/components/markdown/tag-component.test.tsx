import { render, screen } from "@testing-library/react";

import { TagComponent } from "./tag-component";

describe("TagComponent", () => {
  it("renders tag name inside badge", () => {
    render(<TagComponent name="Operations" />);

    expect(screen.getByText("Operations")).toBeVisible();
  });

  it("adds title for hover tooltip", () => {
    render(<TagComponent name="Logistics" />);

    expect(screen.getByText("Logistics")).toHaveAttribute("title", "Logistics");
  });
});
