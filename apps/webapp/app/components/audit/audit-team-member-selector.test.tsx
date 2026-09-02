import type { ComponentPropsWithoutRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AuditTeamMemberSelector from "./audit-team-member-selector";

/**
 * The multi-select assignee picker.
 *
 * why this test exists: the picker's only output is a set of hidden inputs.
 * If it emitted repeated same-name fields the server would keep one person;
 * if a pre-selected member lost their user id before the list loaded, saving
 * the edit dialog would silently remove the whole team. Both are invisible
 * in the browser and only show up as missing assignees later.
 *
 * @see {@link file://./audit-team-member-selector.tsx}
 */

// why: the picker fetches /api/audits/team-members on mount; the stub feeds a
// fixed member list and lets one test simulate the still-loading state.
const mockUseApiQuery = vi.fn();
vi.mock("~/hooks/use-api-query", () => ({
  default: (...args: unknown[]) => mockUseApiQuery(...args),
}));

// why: "Assign to self" needs a current user; there is no root loader here.
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: the shared Button pulls in router-aware rendering; a plain button is
// all the picker needs here.
vi.mock("~/components/shared/button", () => ({
  Button: ({ children, ...rest }: ComponentPropsWithoutRef<"button">) => (
    <button {...rest}>{children}</button>
  ),
}));

// why: the picker disables its self toggle while the enclosing form submits;
// no form or navigation exists in this test, so it is never submitting.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

const members = [
  {
    id: "tm-1",
    name: "Ana Lead",
    user: {
      id: "user-1",
      firstName: "Ana",
      lastName: "Lead",
      displayName: null,
      email: "ana@x.io",
      profilePicture: null,
    },
  },
  {
    id: "tm-2",
    name: "Ben Scan",
    user: {
      id: "user-2",
      firstName: "Ben",
      lastName: "Scan",
      displayName: null,
      email: "ben@x.io",
      profilePicture: null,
    },
  },
  {
    id: "tm-3",
    name: "Cy Count",
    user: {
      id: "user-3",
      firstName: "Cy",
      lastName: "Count",
      displayName: null,
      email: "cy@x.io",
      profilePicture: null,
    },
  },
];

/** The member's row: a checkbox whose accessible name includes their name. */
const row = (name: string) =>
  screen.getByRole("checkbox", { name: new RegExp(name) });

function hiddenInputs(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="hidden"]')
  ).map((input) => ({
    name: input.name,
    value: JSON.parse(input.value) as {
      id: string;
      userId: string;
      name: string;
    },
  }));
}

describe("AuditTeamMemberSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiQuery.mockReturnValue({
      isLoading: false,
      data: { teamMembers: members },
    });
  });

  it("emits one bracket-indexed hidden input per selected member", () => {
    const { container } = render(<AuditTeamMemberSelector />);

    fireEvent.click(row("Ben Scan"));
    fireEvent.click(row("Cy Count"));

    expect(hiddenInputs(container)).toEqual([
      {
        name: "assignees[0]",
        value: { id: "tm-2", userId: "user-2", name: "Ben Scan" },
      },
      {
        name: "assignees[1]",
        value: { id: "tm-3", userId: "user-3", name: "Cy Count" },
      },
    ]);
    expect(screen.getByText("Selected (2):").parentElement?.textContent).toBe(
      "Selected (2): Ben Scan, Cy Count"
    );
  });

  it("clicking a selected member again removes them and re-indexes the rest", () => {
    const { container } = render(<AuditTeamMemberSelector />);

    fireEvent.click(row("Ben Scan"));
    fireEvent.click(row("Cy Count"));
    fireEvent.click(row("Ben Scan"));

    expect(hiddenInputs(container).map((i) => i.name)).toEqual([
      "assignees[0]",
    ]);
    expect(hiddenInputs(container)[0].value.userId).toBe("user-3");
  });

  it("keeps pre-selected members submittable before the member list has loaded", () => {
    mockUseApiQuery.mockReturnValue({ isLoading: true, data: undefined });

    const { container } = render(
      <AuditTeamMemberSelector
        defaultSelected={[
          { id: "tm-2", userId: "user-2", name: "Ben Scan" },
          { id: "tm-3", userId: "user-3", name: "Cy Count" },
        ]}
      />
    );

    expect(hiddenInputs(container).map((i) => i.value.userId)).toEqual([
      "user-2",
      "user-3",
    ]);
  });

  it("'Assign to self' adds the current user alongside existing selections", () => {
    const { container } = render(
      <AuditTeamMemberSelector
        defaultSelected={[{ id: "tm-2", userId: "user-2", name: "Ben Scan" }]}
      />
    );

    fireEvent.click(screen.getByText("Assign to self"));

    expect(hiddenInputs(container).map((i) => i.value.userId)).toEqual([
      "user-2",
      "user-1",
    ]);
    expect(screen.getByText("Remove me")).toBeTruthy();
  });

  it("'Remove me' takes only the current user out of the selection", () => {
    const { container } = render(
      <AuditTeamMemberSelector
        defaultSelected={[
          { id: "tm-2", userId: "user-2", name: "Ben Scan" },
          { id: "tm-1", userId: "user-1", name: "Ana Lead" },
        ]}
      />
    );

    fireEvent.click(screen.getByText("Remove me"));

    expect(hiddenInputs(container).map((i) => i.value.userId)).toEqual([
      "user-2",
    ]);
    expect(screen.getByText("Assign to self")).toBeTruthy();
  });

  it("still submits a selected member when the search filter hides their row", () => {
    const { container } = render(<AuditTeamMemberSelector />);

    fireEvent.click(row("Ben Scan"));
    fireEvent.change(screen.getByPlaceholderText("Find team members"), {
      target: { value: "zzz" },
    });

    expect(screen.queryByRole("checkbox", { name: /Ben Scan/ })).toBeNull();
    expect(hiddenInputs(container)[0].value).toEqual({
      id: "tm-2",
      userId: "user-2",
      name: "Ben Scan",
    });
  });
});
