// @vitest-environment node
/**
 * Kit detail loader — who holds the kit through a booking is withheld
 * SERVER-SIDE from viewers who may not see it.
 *
 * The page's `CustodyCard` hides a booking's holder from a viewer without
 * custody visibility, but hiding is not withholding: whatever the loader
 * returns is readable from the network response. `currentBooking` is derived
 * from the kit's member slices, so it must be derived from the kit AFTER
 * `redactCustodianForViewer` has emptied the custodians the viewer may not
 * see — never from the raw query result.
 *
 * The redaction helper and `getKitCurrentBooking` both run for real; only the
 * data fetch and the gate are stubbed.
 *
 * @see {@link file://./../../../app/routes/_layout+/kits.$kitId.tsx}
 * @see {@link file://./../../../app/utils/custody-visibility.server.ts}
 */

import { OrganizationRoles } from "@prisma/client";

// why: importing the route pulls in `db.server`, whose non-production
// initialization calls `db.$connect()`; without this the test attempts a real
// PostgreSQL connection.
vi.mock("~/database/db.server", () => ({
  db: { $connect: vi.fn(), $transaction: vi.fn() },
}));

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test — it must pass, and it is what hands
// the loader `canSeeAllCustody`, which each test sets.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

// why: the last-scan lookup reaches the database and is covered by its own
// suite (`kits.$kitId.last-scan.test.ts`).
vi.mock("~/modules/scan/service.server", () => ({
  getLastScanForViewer: vi.fn().mockResolvedValue(null),
  getScanByQrId: vi.fn(),
}));

const { mockGetKit } = vi.hoisted(() => ({ mockGetKit: vi.fn() }));
// why: `getKit` is the data fetch, which needs a database. The real
// `getKitCurrentBooking` is kept: which booking the loader derives, and from
// which copy of the kit, is exactly what these tests are about.
vi.mock("~/modules/kit/service.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/modules/kit/service.server")>();
  return {
    getKit: mockGetKit,
    deleteKit: vi.fn(),
    deleteKitImage: vi.fn(),
    getKitCurrentBooking: actual.getKitCurrentBooking,
  };
});

// why: `generateQrObj` runs beside the kit fetch and reaches the database.
vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: vi.fn().mockResolvedValue({ qr: null }),
}));

import { loader } from "~/routes/_layout+/kits.$kitId";

const ORG = "org-1";
const HOLDER_USER_ID = "user-holder";
const HOLDER_EMAIL = "carol@example.com";

/**
 * A kit whose one member is out on an ONGOING booking held by `user-holder`,
 * through both custody links.
 */
function kitOutOnBooking() {
  return {
    id: "kit-1",
    name: "Camera kit",
    qrCodes: [{ id: "qr-1" }],
    custody: null,
    barcodes: [],
    assetKits: [
      {
        id: "assetkit-1",
        asset: {
          id: "asset-1",
          availableToBook: true,
          bookingAssets: [
            {
              assetKitId: "assetkit-1",
              sourceKitId: "kit-1",
              checkedOutAt: new Date("2026-03-02T09:30:00Z"),
              checkedInAt: null,
              booking: {
                id: "booking-1",
                name: "Field shoot",
                from: new Date("2026-03-02T09:30:00Z"),
                status: "ONGOING",
                custodianTeamMember: {
                  name: "Carol Member",
                  userId: HOLDER_USER_ID,
                },
                custodianUser: {
                  id: HOLDER_USER_ID,
                  firstName: "Carol",
                  lastName: "Legal",
                  displayName: "Caz",
                  profilePicture: null,
                  // Not selected by the loader; present so the redaction is
                  // shown to strip it should a wider row ever arrive.
                  email: HOLDER_EMAIL,
                },
              },
            },
          ],
        },
      },
    ],
  };
}

/** Runs the loader as `viewerUserId`, with or without custody visibility. */
async function loadAs(viewerUserId: string, canSeeAllCustody: boolean) {
  mockRequirePermission.mockResolvedValue({
    organizationId: ORG,
    currentOrganization: { id: ORG },
    canUseBarcodes: false,
    canSeeAllCustody,
    userOrganizations: [
      { organization: { id: ORG }, roles: [OrganizationRoles.SELF_SERVICE] },
    ],
  });
  const result = await loader({
    request: new Request("https://app.shelf.nu/kits/kit-1"),
    params: { kitId: "kit-1" },
    context: { getSession: () => ({ userId: viewerUserId, email: "a@b.c" }) },
  } as unknown as Parameters<typeof loader>[0]);
  return result as unknown as {
    currentBooking: ReturnType<
      typeof kitOutOnBooking
    >["assetKits"][0]["asset"]["bookingAssets"][0]["booking"];
  };
}

describe("kit detail loader — booking holder visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetKit.mockResolvedValue(kitOutOnBooking());
  });

  it("withholds someone else's booking holder from a viewer without custody visibility", async () => {
    const result = await loadAs("user-viewer", false);

    // The booking itself still arrives: the card needs to know one exists.
    expect(result.currentBooking.id).toBe("booking-1");
    // Nothing that names or identifies the holder does — anywhere on the wire.
    const wire = JSON.stringify(result);
    expect(wire).not.toContain(HOLDER_USER_ID);
    expect(wire).not.toContain(HOLDER_EMAIL);
    expect(wire).not.toContain("Carol");
    expect(wire).not.toContain("Caz");
  });

  it("keeps the holder on a booking the viewer holds, so their card can show it", async () => {
    const result = await loadAs(HOLDER_USER_ID, false);

    expect(result.currentBooking.custodianTeamMember).toMatchObject({
      name: "Carol Member",
      userId: HOLDER_USER_ID,
    });
    expect(result.currentBooking.custodianUser).toMatchObject({
      id: HOLDER_USER_ID,
    });
  });

  it("asks for only the holder fields the card and the redaction read", async () => {
    await loadAs("user-viewer", true);

    // A whole TeamMember or User row carries email and billing data, and the
    // loader returns this booking to every role that may read the kit.
    const { extraInclude } = mockGetKit.mock.calls[0][0];
    const bookingSelect =
      extraInclude.assetKits.select.asset.select.bookingAssets.select.booking
        .select;
    expect(bookingSelect.custodianTeamMember).toEqual({
      select: { name: true, userId: true },
    });
    expect(bookingSelect.custodianUser.select).not.toHaveProperty("email");
  });

  it("keeps the holder for a viewer who may see all custody", async () => {
    const result = await loadAs("user-viewer", true);

    expect(result.currentBooking.custodianTeamMember).toMatchObject({
      name: "Carol Member",
    });
  });
});
