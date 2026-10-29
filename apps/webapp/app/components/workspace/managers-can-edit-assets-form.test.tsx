/**
 * Tests for the owner-only Managers switch on the Permissions card.
 *
 * Pins what the settings action depends on (the field name and the intent)
 * and the owner lock: only the owner's change is submitted, everyone else
 * sees a disabled switch and the same note as the explicit check-in card.
 *
 * Mocks:
 * - `react-router`'s `useFetcher`: a plain `<form>` plus a captured `submit`.
 * - `~/hooks/use-role-access`: picks owner or non-owner per test.
 *
 * @see {@link file://./managers-can-edit-assets-form.tsx}
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ManagersCanEditAssetsForm,
  ManagersCanEditAssetsSchema,
} from "./managers-can-edit-assets-form";

const mockSubmit = vi.fn();
const mockUseRoleAccess = vi.fn(() => ({ ownsWorkspace: true }));

// why: useFetcher needs a data router; a plain form plus a captured `submit`
// lets the tests read exactly what the form would send to the action.
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
      state: "idle",
      data: undefined,
      Form: MockForm,
      submit: mockSubmit,
    }),
  };
});

// why: ownership comes from the layout route's loader data; each test picks
// owner or non-owner directly instead of building a data router.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => mockUseRoleAccess(),
}));

const OWNER_ONLY_NOTE = "Only the workspace owner can change this setting.";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRoleAccess.mockReturnValue({ ownsWorkspace: true });
});

describe("ManagersCanEditAssetsForm", () => {
  it("posts the switch under its own intent when the owner turns it on", () => {
    render(<ManagersCanEditAssetsForm defaultChecked={false} />);

    fireEvent.click(
      screen.getByRole("switch", { name: "Add and edit assets and kits" })
    );

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const formData = new FormData(
      mockSubmit.mock.calls[0][0] as HTMLFormElement
    );
    expect(formData.get("intent")).toBe("updateManagersCanEditAssets");
    expect(formData.get("managersCanEditAssets")).toBe("on");
    expect(screen.queryByText(OWNER_ONLY_NOTE)).toBeNull();
  });

  it("shows an Administrator the stored value, disabled, with the owner-only note", () => {
    mockUseRoleAccess.mockReturnValue({ ownsWorkspace: false });
    render(<ManagersCanEditAssetsForm defaultChecked={true} />);

    const toggle = screen.getByRole("switch", {
      name: "Add and edit assets and kits",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeDisabled();
    screen.getByText(OWNER_ONLY_NOTE);

    fireEvent.click(toggle);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("states what the switch opens and what stays closed", () => {
    render(<ManagersCanEditAssetsForm defaultChecked={false} />);

    screen.getByText(
      "Switch on to let Managers add and edit assets and kits, update locations and link codes. They still cannot delete, archive, or create categories, locations, tags, custom fields or asset models."
    );
  });
});

describe("ManagersCanEditAssetsSchema", () => {
  it('reads "on" as on and an absent field as off', () => {
    expect(
      ManagersCanEditAssetsSchema.parse({ managersCanEditAssets: "on" })
    ).toEqual({ managersCanEditAssets: true });
    expect(ManagersCanEditAssetsSchema.parse({})).toEqual({
      managersCanEditAssets: false,
    });
  });
});
