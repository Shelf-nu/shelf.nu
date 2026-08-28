import type { AnchorHTMLAttributes, PropsWithChildren } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The evidence chip on an audit's asset row.
 *
 * why this test exists: the chip is the ONLY thing on the audit overview
 * that says a row holds condition notes or photos. Without it the one
 * damaged asset in a 200-row audit is indistinguishable from the 199 clean
 * ones, and the evidence someone stood there and recorded is reachable only
 * by scrolling the Activity feed or opening rows on spec.
 *
 * @see {@link file://./audit-asset-list-item.tsx}
 */

const mockUseLoaderData = vi.fn();

// why: the component reads its route's loader data; no router is running here.
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useLoaderData: () => mockUseLoaderData(),
    Link: ({
      to,
      children,
      ...rest
    }: PropsWithChildren<
      AnchorHTMLAttributes<HTMLAnchorElement> & { to?: unknown }
    >) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children}
      </a>
    ),
  };
});

// why: these read org/user context from hooks that need a running app; the
// chip's behaviour does not depend on either.
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => null,
}));
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({ roles: [], isBaseOrSelfService: false }),
}));
// why: the row asks this to decide whether to offer the remove action. False
// keeps that column out of the way — the evidence chip is what is under test.
vi.mock("~/utils/permissions/permission.validator.client", () => ({
  userHasPermission: () => false,
}));
// why: the real hook needs a router. The chip does not read search params, so
// a stable empty set keeps the render deterministic.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

const { AuditAssetListItem } = await import("./audit-asset-list-item");

const SESSION = { id: "audit-1", status: "COMPLETED", completedAt: new Date() };

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    title: "Arri Fresnel 650 Plus",
    mainImage: null,
    thumbnailImage: null,
    category: null,
    location: null,
    custody: [],
    tags: [],
    qrCodes: [],
    barcodes: [],
    auditData: {
      auditAssetId: "aa-1",
      expected: true,
      auditStatus: "FOUND",
      auditNotesCount: 0,
      auditImagesCount: 0,
    },
    ...overrides,
  };
}

function renderRow(itemData: ReturnType<typeof item>) {
  mockUseLoaderData.mockReturnValue({
    session: SESSION,
    canRemoveAssets: false,
  });
  return render(
    <table>
      <tbody>
        {/* why: the component renders the row's <td> cells, not the <tr>
            itself, so the harness supplies the row wrapper. */}
        <tr>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <AuditAssetListItem item={itemData as any} />
        </tr>
      </tbody>
    </table>
  );
}

describe("AuditAssetListItem — evidence chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says nothing when the row holds no evidence", () => {
    // why: a chip on every row is the same as no chip at all — the point is
    // that it distinguishes.
    renderRow(item());

    expect(screen.queryByLabelText(/note|photo/i)).toBeNull();
  });

  it("keeps notes and photos as two separate counts", () => {
    // why NOT one summed number: it would not be comparable between rows.
    // Photos uploaded with a caption store a COMMENT alongside them; the same
    // photos with no caption store an UPDATE, which is not evidence and is not
    // counted. A single digit would read differently for identical evidence.
    renderRow(
      item({
        auditData: {
          auditAssetId: "aa-1",
          expected: true,
          auditStatus: "FOUND",
          auditNotesCount: 2,
          auditImagesCount: 1,
        },
      })
    );

    expect(
      screen.getByLabelText("2 notes, 1 photo on Arri Fresnel 650 Plus")
    ).toBeTruthy();
    // both numbers on screen, never their sum
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.queryByText("3")).toBeNull();
  });

  it("names only the kind that is actually there", () => {
    // why: "1 note" on a row with no photo, not "1 note, 0 photos".
    renderRow(
      item({
        auditData: {
          auditAssetId: "aa-1",
          expected: true,
          auditStatus: "FOUND",
          auditNotesCount: 1,
          auditImagesCount: 0,
        },
      })
    );

    expect(
      screen.getByLabelText("1 note on Arri Fresnel 650 Plus")
    ).toBeTruthy();
  });

  it("shows the photo count on a row with photos but no note", () => {
    // why: uploading photos without a caption writes no COMMENT at all, so
    // this is the shape of the common field case. A notes-only indicator
    // would have rendered nothing here.
    renderRow(
      item({
        auditData: {
          auditAssetId: "aa-1",
          expected: true,
          auditStatus: "FOUND",
          auditNotesCount: 0,
          auditImagesCount: 2,
        },
      })
    );

    expect(
      screen.getByLabelText("2 photos on Arri Fresnel 650 Plus")
    ).toBeTruthy();
  });

  it("links into the existing notes-and-images panel", () => {
    // why: the chip must lead somewhere. Reusing the details panel avoids a
    // second place to read the same evidence, and that route has no status
    // gate, so it still opens on a completed audit.
    renderRow(
      item({
        auditData: {
          auditAssetId: "aa-1",
          expected: true,
          auditStatus: "FOUND",
          auditNotesCount: 1,
          auditImagesCount: 1,
        },
      })
    );

    const chip = screen.getByLabelText(
      "1 note, 1 photo on Arri Fresnel 650 Plus"
    );
    expect(chip.getAttribute("href")).toBe("/audits/audit-1/scan/aa-1/details");
  });

  it("stays silent when the audit-asset link is missing", () => {
    // why: without an auditAssetId there is nowhere to send the reader, so a
    // chip would be a dead control.
    renderRow(
      item({
        auditData: {
          auditAssetId: null,
          expected: true,
          auditStatus: "FOUND",
          auditNotesCount: 3,
          auditImagesCount: 0,
        },
      })
    );

    expect(screen.queryByLabelText(/note|photo/i)).toBeNull();
  });
});
