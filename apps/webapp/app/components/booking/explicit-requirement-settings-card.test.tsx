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
 * - `~/hooks/user-user-role-helper`: picks owner or non-owner per test.
 *
 * @see {@link file://./explicit-requirement-settings-card.tsx}
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExplicitCheckinSettings } from "./explicit-checkin-settings";
import { ExplicitCheckoutSettings } from "./explicit-checkout-settings";

const mockSubmit = vi.fn();
const mockUseUserRoleHelper = vi.fn(() => ({ isOwner: true }));

// why: useFetcher needs a data router; a plain form plus a captured `submit`
// lets the tests read exactly what the card would send to the action.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle",
      data: undefined,
      Form: ({
        children,
        ...rest
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => <form {...rest}>{children}</form>,
      submit: mockSubmit,
    }),
  };
});

// why: the role helper reads the layout route's loader data; the tests pick
// the viewer's role directly instead of building a data router.
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => mockUseUserRoleHelper(),
}));

const checkoutHeader = { title: "Explicit check-out requirement" };

/** The form the card handed to `fetcher.submit`, as the action receives it. */
function submittedFormData() {
  expect(mockSubmit).toHaveBeenCalledTimes(1);
  return new FormData(mockSubmit.mock.calls[0][0] as HTMLFormElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseUserRoleHelper.mockReturnValue({ isOwner: true });
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
        name: "Require explicit check-out for Admins",
      })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", {
        name: "Require explicit check-out for Self Service",
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
        name: "Require explicit check-out for Self Service",
      })
    );

    const formData = submittedFormData();
    expect(formData.get("intent")).toBe("updateExplicitCheckout");
    // A checked switch posts "on"; an unchecked one posts nothing, which the
    // action's schema reads as false.
    expect(formData.get("requireExplicitCheckoutForSelfService")).toBe("on");
    expect(formData.get("requireExplicitCheckoutForAdmin")).toBeNull();
  });

  it("keeps the switches read-only for anyone but the owner", () => {
    mockUseUserRoleHelper.mockReturnValue({ isOwner: false });

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
      name: "Require explicit check-out for Admins",
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
        header={{ title: "Explicit check-in requirement" }}
        defaultValues={{
          requireExplicitCheckinForAdmin: false,
          requireExplicitCheckinForSelfService: true,
        }}
      />
    );

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Require explicit check-in for Admins",
      })
    );

    const formData = submittedFormData();
    expect(formData.get("intent")).toBe("updateExplicitCheckin");
    expect(formData.get("requireExplicitCheckinForAdmin")).toBe("on");
    expect(formData.get("requireExplicitCheckinForSelfService")).toBe("on");
  });
});
