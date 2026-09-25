/**
 * Role gating for the "Add code" button in {@link CodePreview}.
 *
 * Adding a code writes to the asset, so the button follows the `asset:update`
 * grant: members who may edit assets see it, SELF_SERVICE and BASE do not, and
 * a membership that is still loading (no roles) does not either.
 *
 * @see {@link file://./code-preview.tsx}
 */
import type { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUserRoleHelper } from "~/hooks/user-user-role-helper";

import { CodePreview } from "./code-preview";

// why: the layout loader supplies the roles, and it is not mounted here
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: vi.fn(),
}));

// why: the organization comes from the layout loader, which is not mounted
// here; barcodes are on so the button renders without its "unlock" reason card
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => ({
    barcodesEnabled: true,
    showShelfBranding: true,
    qrIdDisplayPreference: "QR_ID",
  }),
}));

// why: the dialog mounts a fetcher form that needs a data router; only the
// button that opens it is under test
vi.mock("./add-barcode-dialog", () => ({
  AddBarcodeDialog: () => null,
}));

/** Renders the preview for an asset with one QR code, as `roles`. */
function renderAs(roles: OrganizationRoles[] | undefined) {
  vi.mocked(useUserRoleHelper).mockReturnValue({
    roles,
    isOwner: roles?.includes("OWNER") ?? false,
  } as unknown as ReturnType<typeof useUserRoleHelper>);

  return render(
    <CodePreview
      item={{ id: "asset-1", name: "Drill", type: "asset" }}
      qrObj={{ qr: { id: "qr-1", size: "medium", src: "data:image/png," } }}
    />
  );
}

describe("CodePreview: Add code button", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([[["ADMIN"]], [["OWNER"]], [["SELF_SERVICE", "ADMIN"]]] as const)(
    "is offered to %j",
    (roles) => {
      renderAs([...roles]);
      expect(
        screen.getByRole("button", { name: /add code/i })
      ).toBeInTheDocument();
    }
  );

  it.each([[["SELF_SERVICE"]], [["BASE"]], [[]]] as const)(
    "is not offered to %j",
    (roles) => {
      renderAs([...roles]);
      expect(
        screen.queryByRole("button", { name: /add code/i })
      ).not.toBeInTheDocument();
    }
  );

  it("is not offered while the membership is still loading", () => {
    renderAs(undefined);
    expect(
      screen.queryByRole("button", { name: /add code/i })
    ).not.toBeInTheDocument();
  });
});
