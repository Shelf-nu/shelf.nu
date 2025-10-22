import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { ChoosePurpose } from "./choose-purpose";

const mockUseNavigation = vi.fn();

// why: component relies on Remix navigation state and Link component for CTA rendering
vi.mock("@remix-run/react", async () => {
  const actual = (await vi.importActual("@remix-run/react")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    useNavigation: () => mockUseNavigation(),
    Link: ({ to, children, ...rest }: any) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children}
      </a>
    ),
  };
});

describe("ChoosePurpose", () => {
  beforeEach(() => {
    mockUseNavigation.mockReturnValue({ state: "idle" });
  });

  it("renders the updated welcome copy and guardrail hint", () => {
    render(<ChoosePurpose />);

    expect(
      screen.getByRole("heading", {
        name: "How would you like to get started with Shelf?",
      })
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "Your choice determines which features we prepare for you. You can always switch later."
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "If your organization already uses Shelf, you don’t need to create a new workspace — look for your email invite or sign in instead."
      )
    ).toBeInTheDocument();
  });

  it("shows personal and team cards with the requested chips and badges", () => {
    render(<ChoosePurpose />);

    const personalCard = screen.getByRole("button", { name: /personal/i });
    const teamCard = screen.getByRole("button", { name: /team/i });

    expect(within(personalCard).getByText("Free")).toBeInTheDocument();
    expect(
      within(personalCard).getByText(
        "For testing or individual use. Includes 3 custom fields and branded QR labels."
      )
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "Personal workspaces are free and ready to use immediately."
      )
    ).toBeInTheDocument();

    expect(within(teamCard).getByText("7-day trial")).toBeInTheDocument();
    expect(within(teamCard).getByText("Recommended")).toBeInTheDocument();
    expect(
      within(teamCard).getByText(
        "For organizations and labs. Includes collaboration features with a 7-day free trial. No credit card required."
      )
    ).toBeInTheDocument();
  });

  it("routes personal selections to /assets with the correct CTA label and analytics hook", async () => {
    const user = userEvent.setup();
    render(<ChoosePurpose />);

    const personalCard = screen.getByRole("button", { name: /personal/i });
    await act(async () => {
      await user.click(personalCard);
    });

    const cta = await screen.findByRole("link", { name: "Start using Shelf" });
    expect(cta).toHaveAttribute("href", "/assets");
    expect(cta).toHaveAttribute("data-analytics", "cta-start-personal");
  });

  it("routes team selections to /select-plan with the correct CTA label and analytics hook", async () => {
    const user = userEvent.setup();
    render(<ChoosePurpose />);

    const teamCard = screen.getByRole("button", { name: /team/i });
    await act(async () => {
      await user.click(teamCard);
    });

    const cta = await screen.findByRole("link", {
      name: "Next: Select a plan",
    });
    expect(cta).toHaveAttribute("href", "/select-plan");
    expect(cta).toHaveAttribute("data-analytics", "cta-next-team");
  });
});
