/**
 * The plan-page pieces that depend on a signup intent: the way back to a
 * Personal workspace, and the call-to-action order the link asked for.
 *
 * @see {@link file://./select-plan-intent.tsx}
 */
import type React from "react";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { PlanIntent } from "~/modules/signup-intent/schema";
import {
  PersonalWorkspaceEscapeLink,
  SelectPlanSubmitButtons,
} from "./select-plan-intent";

/** Renders inside a router so `<Button to>` can produce a real link. */
function renderInRouter(element: React.ReactElement) {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("PersonalWorkspaceEscapeLink", () => {
  it("links to the free Personal workspace, as choosing Personal on /welcome does", () => {
    renderInRouter(<PersonalWorkspaceEscapeLink />);

    const link = screen.getByRole("link", {
      name: "Continue with a free Personal workspace instead",
    });
    expect(link).toHaveAttribute("href", "/assets");
  });
});

describe("SelectPlanSubmitButtons", () => {
  function submitButtonsFor(planIntent: PlanIntent | null) {
    renderInRouter(
      <form>
        <SelectPlanSubmitButtons
          planIntent={planIntent}
          disabled={false}
          freeTrialDays={7}
        />
      </form>
    );
    return screen.getAllByRole("button").map((button) => {
      // `Button` inlines a <style> for its hover icon; only the words count.
      button.querySelectorAll("style").forEach((style) => style.remove());
      return {
        intent: button.getAttribute("value"),
        label: button.textContent?.trim(),
      };
    });
  }

  it("keeps the single trial button without an intent", () => {
    expect(submitButtonsFor(null)).toEqual([
      { intent: "trial", label: "Start 7-day free trial" },
    ]);
  });

  it("leads with the trial when the link asked for one", () => {
    expect(submitButtonsFor({ plan: "team", trial: true })).toEqual([
      { intent: "trial", label: "Start 7-day free trial" },
      { intent: "subscribe", label: "Subscribe now instead" },
    ]);
  });

  it("leads with subscribing when the link asked for Team without a trial", () => {
    expect(submitButtonsFor({ plan: "team", trial: false })).toEqual([
      { intent: "subscribe", label: "Subscribe to Team" },
      { intent: "trial", label: "Start 7-day free trial instead" },
    ]);
  });

  it("treats a non-Team plan like no intent", () => {
    expect(submitButtonsFor({ plan: "plus", trial: true })).toEqual([
      { intent: "trial", label: "Start 7-day free trial" },
    ]);
  });
});
