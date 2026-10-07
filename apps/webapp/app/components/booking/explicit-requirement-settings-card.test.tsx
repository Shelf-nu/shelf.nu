/**
 * Tests for the explicit check-in and check-out requirement cards.
 *
 * Both cards render through {@link ExplicitRequirementSettingsCard}. These
 * tests pin what the settings action depends on (the field names and the
 * intent each card posts) and the owner-only behaviour: only the workspace
 * owner's change is submitted, everyone else sees read-only switches.
 *
 * Mocks:
 * - `react-router`'s `useFetcher`: a plain `<form>` plus a captured `submit`,
 *   so the tests need no data router.
 * - `~/hooks/use-role-access`: picks owner or non-owner per test.
 *
 * @see {@link file://./explicit-requirement-settings-card.tsx}
 */
import type { ReactNode } from "react";
import { EXPLICIT_REQUIREMENT_LABELS } from "@shelf/labels";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExplicitCheckinSettings } from "./explicit-checkin-settings";
import { ExplicitCheckoutSettings } from "./explicit-checkout-settings";

const mockSubmit = vi.fn();
const mockUseRoleAccess = vi.fn(() => ({ ownsWorkspace: true }));

/** What the fetcher reports; a test changes it and re-renders to play the action's answer. */
const fetcherState: { state: "idle" | "submitting"; data: unknown } = {
  state: "idle",
  data: undefined,
};

// why: useFetcher needs a data router; a plain form plus a captured `submit`
// lets the tests read exactly what the card would send to the action, and
// `fetcherState` lets them play back what the action answered. `Form` is one
// component for the whole run: a new one per render would remount the
// switches on every re-render and hide whether the card resets them itself.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  const MockForm = ({
    children,
    ...rest
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <form {...rest}>{children}</form>;
  return {
    ...actual,
    useFetcher: () => ({
      state: fetcherState.state,
      data: fetcherState.data,
      Form: MockForm,
      submit: mockSubmit,
    }),
  };
});

// why: the card reads workspace ownership from the layout route's loader
// data; each test picks owner or non-owner directly instead of building a
// data router.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => mockUseRoleAccess(),
}));

const checkoutHeader = { title: EXPLICIT_REQUIREMENT_LABELS.CHECKOUT.TITLE };

/** The form the card handed to `fetcher.submit`, as the action receives it. */
function submittedFormData() {
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  return new FormData(mockSubmit.mock.calls[0][0] as HTMLFormElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRoleAccess.mockReturnValue({ ownsWorkspace: true });
  fetcherState.state = "idle";
  fetcherState.data = undefined;
});

describe("ExplicitCheckoutSettings", () => {
  it("shows one labelled switch per role, set from the stored values", () => {
    render(
      <ExplicitCheckoutSettings
        header={checkoutHeader}
        defaultValues={{
          requireExplicitCheckoutForAdmin: true,
          requireExplicitCheckoutForSelfService: false,
        }}
      />
    );

    expect(
      screen.getByRole("switch", {
        name: "Admins",
      })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", {
        name: "Self Service users",
      })
    ).toHaveAttribute("aria-checked", "false");
  });

  it("posts both switches under the check-out intent when the owner flips one", () => {
    render(
      <ExplicitCheckoutSettings
        header={checkoutHeader}
        defaultValues={{
          requireExplicitCheckoutForAdmin: false,
          requireExplicitCheckoutForSelfService: false,
        }}
      />
    );

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Self Service users",
      })
    );

    const formData = submittedFormData();
    expect(formData.get("intent")).toBe("updateExplicitCheckout");
    // A checked switch posts "on"; an unchecked one posts nothing, which the
    // action's schema reads as false.
    expect(formData.get("requireExplicitCheckoutForSelfService")).toBe("on");
    expect(formData.get("requireExplicitCheckoutForAdmin")).toBeNull();
  });

  it("puts a switch back to its stored value when the action refuses the save", () => {
    const stored = {
      requireExplicitCheckoutForAdmin: false,
      requireExplicitCheckoutForSelfService: true,
    };
    const { rerender } = render(
      <ExplicitCheckoutSettings
        header={checkoutHeader}
        defaultValues={stored}
      />
    );
    const adminSwitch = () =>
      screen.getByRole("switch", {
        name: "Admins",
      });

    fireEvent.click(adminSwitch());
    expect(adminSwitch()).toHaveAttribute("aria-checked", "true");

    // The action answers with an error; the stored values still apply.
    fetcherState.data = { error: { message: "Could not save the setting." } };
    rerender(
      <ExplicitCheckoutSettings
        header={checkoutHeader}
        defaultValues={stored}
      />
    );

    expect(adminSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("switch", {
        name: "Self Service users",
      })
    ).toHaveAttribute("aria-checked", "true");

    // The next save posts the stored values, not the refused one.
    mockSubmit.mockClear();
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Self Service users",
      })
    );
    const formData = submittedFormData();
    expect(formData.get("requireExplicitCheckoutForAdmin")).toBeNull();
    expect(formData.get("requireExplicitCheckoutForSelfService")).toBeNull();
  });

  it("keeps the switches read-only for anyone but the owner", () => {
    mockUseRoleAccess.mockReturnValue({ ownsWorkspace: false });

    render(
      <ExplicitCheckoutSettings
        header={checkoutHeader}
        defaultValues={{
          requireExplicitCheckoutForAdmin: false,
          requireExplicitCheckoutForSelfService: false,
        }}
      />
    );

    const adminSwitch = screen.getByRole("switch", {
      name: "Admins",
    });
    expect(adminSwitch).toBeDisabled();
    expect(
      screen.getByText("Only the workspace owner can change this setting.")
    ).toBeInTheDocument();

    fireEvent.click(adminSwitch);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe("ExplicitCheckinSettings", () => {
  it("posts its own fields under the check-in intent", () => {
    render(
      <ExplicitCheckinSettings
        header={{ title: EXPLICIT_REQUIREMENT_LABELS.CHECKIN.TITLE }}
        defaultValues={{
          requireExplicitCheckinForAdmin: false,
          requireExplicitCheckinForSelfService: true,
        }}
      />
    );

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Admins",
      })
    );

    const formData = submittedFormData();
    expect(formData.get("intent")).toBe("updateExplicitCheckin");
    expect(formData.get("requireExplicitCheckinForAdmin")).toBe("on");
    expect(formData.get("requireExplicitCheckinForSelfService")).toBe("on");
  });
});

describe("what the cards say", () => {
  it("states on the check-in card itself who is never restricted, and what the switch removes", () => {
    render(
      <ExplicitCheckinSettings
        header={{ title: EXPLICIT_REQUIREMENT_LABELS.CHECKIN.TITLE }}
        defaultValues={{
          requireExplicitCheckinForAdmin: false,
          requireExplicitCheckinForSelfService: false,
        }}
      />
    );

    // Always visible text, not a tooltip: a reader must not have to hover to
    // learn that the owner is exempt and that Base users cannot check in.
    expect(
      screen.getByText(
        "The workspace owner is never restricted. Base users cannot check in."
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        "Removes the one-click check-in for Admins. They check items in by scanning them or by selecting them from the list."
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        "Removes the one-click check-in for Self Service users. They check items in by scanning them or by selecting them from the list."
      )
    ).toBeVisible();
  });

  it("uses the same words on the check-out card, verb aside", () => {
    render(
      <ExplicitCheckoutSettings
        header={checkoutHeader}
        defaultValues={{
          requireExplicitCheckoutForAdmin: false,
          requireExplicitCheckoutForSelfService: false,
        }}
      />
    );

    expect(
      screen.getByText(
        "The workspace owner is never restricted. Base users cannot check out."
      )
    ).toBeVisible();
    expect(
      screen.getByText(
        "Removes the one-click check-out for Admins. They check items out by scanning them or by selecting them from the list."
      )
    ).toBeVisible();
    // Both cards name the roles the same way, so the two cards read as one rule.
    expect(screen.getByRole("switch", { name: "Admins" })).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Self Service users" })
    ).toBeInTheDocument();
  });
});
