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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installDomMutationGuard,
  uninstallDomMutationGuard,
} from "~/utils/dom-mutation-guard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { translateTextNodes } from "../../../test/helpers/page-translation";

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

/** A controlled picker, so a test can change the chosen option by re-render. */
function CompanySelect({ value }: { value: string }) {
  return (
    <Select name="company" value={value}>
      <SelectTrigger aria-label="Company">
        <SelectValue placeholder="Pick a value" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Company A</SelectItem>
        <SelectItem value="b">Company B</SelectItem>
        <SelectItem value="c">Company C</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select on a translated page", () => {
  beforeEach(() => {
    // why: production installs the guard before hydration (entry.client), so
    // a translated page never throws; the guard's warning is not under test.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installDomMutationGuard();
  });

  afterEach(() => {
    uninstallDomMutationGuard();
    vi.restoreAllMocks();
  });

  it("shows only the newly picked option after the page was translated", () => {
    const { rerender } = render(<CompanySelect value="a" />);
    const trigger = screen.getByRole("combobox", { name: "Company" });
    expect(translateTextNodes(trigger)).toBeGreaterThan(0);

    rerender(<CompanySelect value="b" />);
    // why: translation also rewrites text that appears later.
    translateTextNodes(trigger);
    rerender(<CompanySelect value="c" />);

    // why: the picked option's text is portalled into the trigger. When it
    // was a bare text node, translation replaced it, the old option could not
    // be removed, and every pick appended its text next to the stale ones.
    expect(trigger).toHaveTextContent(/^Company C$/);
  });

  it("replaces the placeholder with the picked option after translation", () => {
    function PlaceholderSelect({ value }: { value?: string }) {
      return (
        <Select name="company" value={value}>
          <SelectTrigger aria-label="Company">
            <SelectValue placeholder="Pick a value" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">Company A</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    const { rerender } = render(<PlaceholderSelect />);
    const trigger = screen.getByRole("combobox", { name: "Company" });
    translateTextNodes(trigger);

    rerender(<PlaceholderSelect value="a" />);

    expect(trigger).toHaveTextContent(/^Company A$/);
  });
});
