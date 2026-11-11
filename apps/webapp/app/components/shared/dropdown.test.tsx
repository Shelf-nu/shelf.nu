/**
 * Keyboard activation of {@link DropdownMenuItem} rows.
 *
 * Radix handles Enter and Space on a menu item by clicking the item element
 * itself. Most rows in this app put their action on a link or button inside
 * the item, which that click never reaches. The shared item forwards the key
 * to that inner control, so the keyboard does what a mouse click on it does.
 *
 * @see {@link file://./dropdown.tsx}
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown";

/** Renders an open menu holding the given rows, inside a router for links. */
function renderMenu(rows: ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <Routes>
        <Route
          path="/start"
          element={
            <DropdownMenu open modal={false}>
              <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
              <DropdownMenuContent>{rows}</DropdownMenuContent>
            </DropdownMenu>
          }
        />
        <Route path="/scan" element={<p>Scan page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

/** Presses `key` on the menu row named `name`, the way roving focus does. */
function pressOnRow(name: string, key: string) {
  const row = screen.getByRole("menuitem", { name });
  row.focus();
  fireEvent.keyDown(row, { key });
}

describe("DropdownMenuItem keyboard activation", () => {
  it.each(["Enter", " "])(
    "clicks the row's inner button once with %j and runs onSelect once",
    (key) => {
      const onClick = vi.fn();
      const onSelect = vi.fn((event: Event) => event.preventDefault());
      renderMenu(
        <DropdownMenuItem onSelect={onSelect}>
          <Button type="button" variant="link" onClick={onClick}>
            Check out selected items
          </Button>
        </DropdownMenuItem>
      );

      pressOnRow("Check out selected items", key);

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledTimes(1);
    }
  );

  it("follows the row's inner link with Enter", () => {
    renderMenu(
      <DropdownMenuItem>
        <Button variant="link" to="/scan">
          Scan to check out
        </Button>
      </DropdownMenuItem>
    );

    pressOnRow("Scan to check out", "Enter");

    expect(screen.getByText("Scan page")).toBeInTheDocument();
  });

  it("does nothing for a row whose inner button is disabled", () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    renderMenu(
      <DropdownMenuItem onSelect={onSelect}>
        <Button type="button" variant="link" disabled onClick={onClick}>
          Remove assets
        </Button>
      </DropdownMenuItem>
    );

    pressOnRow("Remove assets", "Enter");

    expect(onClick).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps Radix's own selection for a row with no inner control", () => {
    const onSelect = vi.fn();
    renderMenu(
      <DropdownMenuItem onSelect={onSelect}>Duplicate</DropdownMenuItem>
    );

    pressOnRow("Duplicate", "Enter");

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
