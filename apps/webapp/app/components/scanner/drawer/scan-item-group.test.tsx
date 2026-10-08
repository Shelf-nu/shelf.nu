/**
 * A foldable group of rows in the booking scan drawers ("Checked out this
 * session", "Pending").
 *
 * Folding unmounts the rows rather than hiding them, so these tests assert on
 * the DOM, never on a role query: a role query treats a `hidden` attribute as
 * gone even when CSS still shows the rows (see
 * `.claude/rules/hidden-attribute-loses-to-display-utilities.md`).
 *
 * @see {@link file://./scan-item-group.tsx}
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScanItemGroup } from "./scan-item-group";

/** One table row, as the drawers' row components render. */
function Row({ name }: { name: string }) {
  return (
    <tr>
      <td>{name}</td>
    </tr>
  );
}

function renderGroup(
  props: Partial<Parameters<typeof ScanItemGroup>[0]> = {},
  rows = ["Kit A"]
) {
  return (
    <ScanItemGroup label="Pending" count={rows.length} tone="muted" {...props}>
      {rows.map((name) => (
        <Row key={name} name={name} />
      ))}
    </ScanItemGroup>
  );
}

describe("ScanItemGroup", () => {
  it("shows its label, count and rows, open by default", () => {
    render(renderGroup({}, ["Kit A", "Tripod"]));

    const toggle = screen.getByRole("button", { name: /Pending/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveTextContent("2");
    expect(document.body).toHaveTextContent("Kit A");
    expect(document.body).toHaveTextContent("Tripod");
  });

  it("folding removes the rows from the page and unfolding brings them back", () => {
    render(renderGroup());
    const toggle = screen.getByRole("button", { name: /Pending/ });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.body).not.toHaveTextContent("Kit A");
    // Nothing to point at while the body is unmounted.
    expect(toggle).not.toHaveAttribute("aria-controls");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.body).toHaveTextContent("Kit A");
  });

  it("reopens when a row is added, if it was asked to, so a new scan is never hidden", () => {
    const { rerender } = render(
      renderGroup({
        label: "Scanned this session",
        tone: "active",
        openWhenCountGrows: true,
      })
    );
    const toggle = screen.getByRole("button", { name: /this session/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    rerender(
      renderGroup(
        {
          label: "Scanned this session",
          tone: "active",
          openWhenCountGrows: true,
        },
        ["Kit A", "Tripod"]
      )
    );

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.body).toHaveTextContent("Tripod");
  });

  it("can start folded, for a group the operator rarely needs", () => {
    render(
      renderGroup({
        label: "Already checked in",
        tone: "done",
        defaultOpen: false,
      })
    );
    const toggle = screen.getByRole("button", { name: /Already checked in/ });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.body).not.toHaveTextContent("Kit A");

    fireEvent.click(toggle);
    expect(document.body).toHaveTextContent("Kit A");
  });

  it("stays folded when rows are added, unless asked to reopen", () => {
    const { rerender } = render(renderGroup());
    const toggle = screen.getByRole("button", { name: /Pending/ });
    fireEvent.click(toggle);

    rerender(renderGroup({}, ["Kit A", "Tripod"]));

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.body).not.toHaveTextContent("Tripod");
  });
});
