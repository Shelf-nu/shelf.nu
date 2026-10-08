/**
 * The assets index bulk menu disables "Assign custody" while the selection
 * holds an individually tracked kit member, and says why.
 *
 * Custody of a kit member comes from its kit. The server refuses the request
 * (`assertNotKitMembers`); the menu says so before the click. Selected rows
 * arrive in two shapes, `assetKits` from simple mode and a flattened `kit`
 * from advanced mode, and both must disable the action.
 *
 * @see {@link file://./bulk-actions-dropdown.tsx}
 * @see {@link file://./../../modules/asset/utils.ts} isIndividualKitMember
 */
import { OrganizationRoles } from "@prisma/client";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisabledProp } from "~/components/shared/button";
import BulkActionsDropdown from "./bulk-actions-dropdown";

/** The selection the mocked `useAtomValue` returns. */
let mockSelectedAssets: Record<string, unknown>[] = [];

/**
 * The `disabled` decision the menu handed each bulk trigger on the last
 * render, keyed by trigger type.
 *
 * why: the trigger is the component's output contract for these items; what
 * the trigger does with `disabled` (the hover card and its accessible
 * description) is the shared Button's job and is covered there.
 */
let capturedDisabled: Record<string, DisabledProp | undefined> = {};

// why: the selection lives in a jotai atom whose `onMount` resets it at
// subscription time, so a seeded selection would be wiped before render.
vi.mock("jotai", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("jotai");
  return { ...actual, useAtomValue: () => mockSelectedAssets };
});

// why: the menu reads navigation state to disable items mid-submit; idle here.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useNavigation: () => ({ state: "idle" }) };
});

// why: `useHydrated` is false on the first render, which renders a placeholder
// button instead of the menu.
vi.mock("remix-utils/use-hydrated", () => ({ useHydrated: () => true }));

// why: the menu's open state comes from this hook, which reads search params;
// forcing it open renders the items the tests read.
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    defaultApplied: true,
    open: true,
    defaultOpen: true,
    setOpen: vi.fn(),
  }),
}));

// why: the roles, the role access and the user all read the `_layout` route
// loader, which is not mounted here. An admin sees every item and assigns
// custody to anyone.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => [OrganizationRoles.ADMIN],
}));
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ custody: { assign: "anyone" } }),
}));
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: captures each trigger's `disabled` decision (see `capturedDisabled`).
vi.mock("../bulk-update-dialog/bulk-update-dialog", () => ({
  BulkUpdateDialogTrigger: ({
    type,
    disabled,
  }: {
    type: string;
    disabled?: DisabledProp;
  }) => {
    capturedDisabled[type] = disabled;
    return null;
  },
}));

// why: every dialog brings its own form, loader and atom chain, renders
// outside the menu, and is not under test.
vi.mock("./bulk-add-to-audit-dialog", () => ({ default: () => null }));
vi.mock("./bulk-add-to-kit-dialog", () => ({ default: () => null }));
vi.mock("./bulk-asset-model-remove-dialog", () => ({ default: () => null }));
vi.mock("./bulk-asset-model-update-dialog", () => ({ default: () => null }));
vi.mock("./bulk-assign-custody-dialog", () => ({ default: () => null }));
vi.mock("./bulk-assign-tags-dialog", () => ({ default: () => null }));
vi.mock("./bulk-category-update-dialog", () => ({ default: () => null }));
vi.mock("./bulk-delete-dialog", () => ({ default: () => null }));
vi.mock("./bulk-location-update-dialog", () => ({ default: () => null }));
vi.mock("./bulk-mark-availability-dialog", () => ({ default: () => null }));
vi.mock("./bulk-release-custody-dialog", () => ({ default: () => null }));
vi.mock("./bulk-remove-from-kits", () => ({ default: () => null }));
vi.mock("./bulk-remove-tags-dialog", () => ({ default: () => null }));
vi.mock("./bulk-start-audit-dialog", () => ({ default: () => null }));
vi.mock("./bulk-download-qr-dialog", () => ({ default: () => null }));
vi.mock("./assets-index/book-selected-assets-dropdown", () => ({
  default: () => null,
}));

const KIT_MEMBERS_REASON =
  "Some of the selected assets are part of a kit. Assign custody to the kit, or remove them from the kit first.";

/** An available asset row as the index loads it. */
function row(overrides: Record<string, unknown>) {
  return {
    id: "asset-1",
    title: "Drill",
    status: "AVAILABLE",
    type: "INDIVIDUAL",
    custody: [],
    ...overrides,
  };
}

function renderWithSelection(selection: Record<string, unknown>[]) {
  mockSelectedAssets = selection;
  render(<BulkActionsDropdown />);
}

describe("assets index bulk menu: custody of kit members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedDisabled = {};
  });

  it("disables Assign custody when a selected simple-mode row is an individual kit member", () => {
    renderWithSelection([
      row({ id: "drill" }),
      row({
        id: "tripod",
        title: "Tripod",
        assetKits: [{ kit: { id: "kit-camera", name: "Camera Kit" } }],
      }),
    ]);

    expect(capturedDisabled["assign-custody"]).toEqual({
      reason: KIT_MEMBERS_REASON,
    });
  });

  it("disables Assign custody when a selected advanced-mode row is an individual kit member", () => {
    renderWithSelection([
      row({
        id: "tripod",
        title: "Tripod",
        kit: { id: "kit-camera", name: "Camera Kit", status: "AVAILABLE" },
      }),
    ]);

    expect(capturedDisabled["assign-custody"]).toEqual({
      reason: KIT_MEMBERS_REASON,
    });
  });

  it("leaves Assign custody enabled for a quantity-tracked asset in a kit", () => {
    renderWithSelection([
      row({
        id: "batteries",
        title: "Batteries",
        type: "QUANTITY_TRACKED",
        assetKits: [{ kit: { id: "kit-camera", name: "Camera Kit" } }],
      }),
    ]);

    expect(capturedDisabled["assign-custody"]).toBe(false);
  });

  it("leaves Assign custody enabled for assets in no kit", () => {
    renderWithSelection([row({ id: "drill" }), row({ id: "saw" })]);

    expect(capturedDisabled["assign-custody"]).toBe(false);
  });
});

/**
 * The older "custody assigned via a kit" reason must fire in both index modes.
 * Simple-mode rows carry the kit only in `assetKits`; reading `row.kit` alone
 * left this reason dead there.
 */
describe("assets index bulk menu: assets whose kit is not available", () => {
  const KIT_CUSTODY_REASON =
    "Some of the selected assets have custody assigned via a kit. If you want to change their custody, please update the kit instead.";

  beforeEach(() => {
    vi.clearAllMocks();
    capturedDisabled = {};
  });

  it("explains Release custody for a simple-mode row whose kit is in custody", () => {
    renderWithSelection([
      row({
        id: "tripod",
        title: "Tripod",
        status: "IN_CUSTODY",
        assetKits: [
          {
            kit: { id: "kit-camera", name: "Camera Kit", status: "IN_CUSTODY" },
          },
        ],
      }),
    ]);

    expect(capturedDisabled["release-custody"]).toEqual({
      reason: KIT_CUSTODY_REASON,
    });
  });

  it("explains Release custody for an advanced-mode row whose kit is in custody", () => {
    renderWithSelection([
      row({
        id: "tripod",
        title: "Tripod",
        status: "IN_CUSTODY",
        kit: { id: "kit-camera", name: "Camera Kit", status: "IN_CUSTODY" },
      }),
    ]);

    expect(capturedDisabled["release-custody"]).toEqual({
      reason: KIT_CUSTODY_REASON,
    });
  });

  it("does not use that reason for a row whose kit is available", () => {
    renderWithSelection([
      row({
        id: "tripod",
        title: "Tripod",
        status: "IN_CUSTODY",
        assetKits: [
          {
            kit: { id: "kit-camera", name: "Camera Kit", status: "AVAILABLE" },
          },
        ],
      }),
    ]);

    expect(capturedDisabled["release-custody"]).not.toEqual({
      reason: KIT_CUSTODY_REASON,
    });
  });
});
