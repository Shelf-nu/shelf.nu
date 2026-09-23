/**
 * TeamPlanNotice: unit tests
 *
 * The notice names the paid teams that cover the member and keeps the plans
 * one click away. These pin the sentence for one, two and three teams (the
 * list reads "A", "A and B", "A, B and C", and the owner sentence follows the
 * count) and that the button asks the page to open the pricing dialog.
 *
 * @see {@link file://./team-plan-notice.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TeamPlanNotice } from "./team-plan-notice";

/** The body sentence as the reader sees it, whitespace collapsed. */
function bodyText() {
  const body = screen.getByText(/You're a member of/);
  return (body.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("TeamPlanNotice", () => {
  it("names the one team and its owner", () => {
    render(
      <TeamPlanNotice
        teams={[{ id: "a", name: "Camera Crew" }]}
        onViewPlans={() => {}}
      />
    );

    expect(screen.getByText("Your team's plan covers you")).toBeInTheDocument();
    expect(bodyText()).toBe(
      "You're a member of Camera Crew. The workspace owner pays for its plan, so you don't need a plan of your own."
    );
  });

  it("joins two teams with 'and' and speaks of their owners", () => {
    render(
      <TeamPlanNotice
        teams={[
          { id: "a", name: "Camera Crew" },
          { id: "b", name: "Lighting Team" },
        ]}
        onViewPlans={() => {}}
      />
    );

    expect(bodyText()).toBe(
      "You're a member of Camera Crew and Lighting Team. The workspace owners pay for their plans, so you don't need a plan of your own."
    );
  });

  it("joins three teams with commas and a final 'and'", () => {
    render(
      <TeamPlanNotice
        teams={[
          { id: "a", name: "Camera Crew" },
          { id: "b", name: "Lighting Team" },
          { id: "c", name: "Sound Stage" },
        ]}
        onViewPlans={() => {}}
      />
    );

    expect(bodyText()).toBe(
      "You're a member of Camera Crew, Lighting Team and Sound Stage. The workspace owners pay for their plans, so you don't need a plan of your own."
    );
  });

  it("sets each team name in bold", () => {
    render(
      <TeamPlanNotice
        teams={[
          { id: "a", name: "Camera Crew" },
          { id: "b", name: "Lighting Team" },
        ]}
        onViewPlans={() => {}}
      />
    );

    expect(screen.getByText("Camera Crew")).toHaveClass("font-semibold");
    expect(screen.getByText("Lighting Team")).toHaveClass("font-semibold");
  });

  it("opens the plans when 'View plans' is clicked", async () => {
    const onViewPlans = vi.fn();
    render(
      <TeamPlanNotice
        teams={[{ id: "a", name: "Camera Crew" }]}
        onViewPlans={onViewPlans}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "View plans" }));

    expect(onViewPlans).toHaveBeenCalledTimes(1);
  });
});
