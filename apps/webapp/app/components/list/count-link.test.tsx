/**
 * CountLink tests.
 *
 * Pins when a list count becomes a link, and that the link's accessible name
 * starts with the number sighted users see.
 *
 * @see {@link file://./count-link.tsx}
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { CountLink } from "./count-link";

describe("CountLink", () => {
  it("links a non-zero count to the list it counts", () => {
    render(
      <MemoryRouter>
        <CountLink
          count={12}
          to="/locations/loc-1/assets"
          label="View the assets in Warehouse"
        />
      </MemoryRouter>
    );

    // The name starts with the visible number, then says what opens.
    const link = screen.getByRole("link", {
      name: /^12\b.*View the assets in Warehouse$/,
    });
    expect(link.getAttribute("href")).toBe("/locations/loc-1/assets");
  });

  it("leaves zero as plain text, since there is nothing to open", () => {
    render(
      <MemoryRouter>
        <CountLink
          count={0}
          to="/locations/loc-1/assets"
          label="View the assets in Warehouse"
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("0")).toBeTruthy();
  });
});
