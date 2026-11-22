/**
 * SelectItem descriptions.
 *
 * A `description` is a second line under an option. It belongs to the open
 * list only: the closed trigger shows just the option's text, and screen
 * readers reach the description through `aria-describedby`.
 *
 * @see {@link file://./select.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

const DESCRIPTION = "Runs bookings, custody and audits for everyone.";

/** A one-option picker whose option carries a description. */
function DescribedSelect({
  open,
  description = DESCRIPTION,
}: {
  open?: boolean;
  description?: string;
}) {
  return (
    <Select name="role" defaultValue="MANAGER" open={open}>
      <SelectTrigger aria-label="Role">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="MANAGER" description={description || undefined}>
          Manager
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("SelectItem description", () => {
  it("shows only the option's text in the closed trigger", () => {
    render(<DescribedSelect />);

    expect(screen.getByRole("combobox", { name: "Role" })).toHaveTextContent(
      /^Manager$/
    );
  });

  it("links the description to its option for screen readers", () => {
    render(<DescribedSelect open />);

    const option = screen.getByRole("option");
    const describedBy = option.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      DESCRIPTION
    );
    expect(within(option).getByText(DESCRIPTION)).toBeInTheDocument();
  });

  it("adds no aria-describedby when the option has no description", () => {
    render(<DescribedSelect open description="" />);

    expect(screen.getByRole("option")).not.toHaveAttribute("aria-describedby");
  });
});
