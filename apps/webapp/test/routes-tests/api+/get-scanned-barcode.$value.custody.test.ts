// @vitest-environment node
/**
 * Web scanned-barcode resolve: which custodians the response names.
 *
 * A viewer without custody visibility (`access.custody.seeAll` false) sees
 * their own custody named and everyone else's redacted, on the asset and on
 * the kit, the same as on the asset and kit pages.
 *
 * @see {@link file://./../../../app/routes/api+/get-scanned-barcode.$value.ts}
 */
import type { OrganizationRoles } from "@prisma/client";

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate is not under test; it passes with the access each case
// describes.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockGetBarcodeByValue } = vi.hoisted(() => ({
  mockGetBarcodeByValue: vi.fn(),
}));
// why: the barcode lookup reads the database; each case hands it a row.
vi.mock("~/modules/barcode/service.server", () => ({
  getBarcodeByValue: mockGetBarcodeByValue,
}));

// why: importing the route pulls in `db.server`, which would open a real
// connection; no request here carries an audit, so nothing else is read.
vi.mock("~/database/db.server", () => ({
  db: { $connect: vi.fn() },
}));

// why: recording writes to the database; it is pinned in
// get-scanned-barcode.$value.records-scan.test.ts.
vi.mock("~/modules/scan/service.server", () => ({
  recordScanNonFatal: vi.fn(),
}));

import { loader } from "~/routes/api+/get-scanned-barcode.$value";
import { accessFor } from "@helpers/role-access";

/** A custodian row as `CUSTODIAN_SELECT` returns it. */
function custodian(userId: string | null, name: string) {
  return {
    userId,
    name,
    user: userId
      ? {
          firstName: name,
          lastName: "Holder",
          displayName: null,
          profilePicture: null,
        }
      : null,
  };
}

/** Resolves one barcode as a member holding `roles`. */
async function resolveAs(roles: OrganizationRoles[]) {
  mockRequirePermission.mockResolvedValue({
    organizationId: "org-1",
    canUseBarcodes: true,
    access: accessFor(roles),
  });
  const result = await loader({
    request: new Request("http://localhost/api/get-scanned-barcode/BC-1"),
    params: { value: "BC-1" },
    context: { getSession: () => ({ userId: "viewer" }) },
  } as unknown as Parameters<typeof loader>[0]);

  return result.data as {
    barcode: {
      asset?: {
        custody: { custodian: ReturnType<typeof custodian> }[];
      };
      kit?: { custody: { custodian: ReturnType<typeof custodian> } | null };
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/get-scanned-barcode/:value custodian visibility", () => {
  beforeEach(() => {
    mockGetBarcodeByValue.mockResolvedValue({
      id: "barcode-1",
      value: "BC-1",
      assetId: "asset-1",
      kitId: null,
      asset: {
        id: "asset-1",
        mainImage: null,
        thumbnailImage: null,
        assetModel: null,
        custody: [
          { quantity: 1, custodian: custodian("someone", "Sam") },
          { quantity: 1, custodian: custodian("viewer", "Vic") },
        ],
      },
      kit: null,
    });
  });

  it("names every asset custodian for a viewer who may see all custody", async () => {
    const body = await resolveAs(["ADMIN"]);

    expect(
      body.barcode.asset?.custody.map((row) => row.custodian.name)
    ).toEqual(["Sam", "Vic"]);
  });

  it("redacts other holders and keeps the viewer's own custody for a restricted role", async () => {
    const body = await resolveAs(["SELF_SERVICE"]);
    const [other, own] = body.barcode.asset?.custody ?? [];

    expect(other.custodian).toEqual({ userId: null, name: "", user: null });
    expect(own.custodian.name).toBe("Vic");
  });

  it("redacts a kit custodian the restricted viewer does not hold", async () => {
    mockGetBarcodeByValue.mockResolvedValue({
      id: "barcode-2",
      value: "BC-1",
      assetId: null,
      kitId: "kit-1",
      asset: null,
      kit: {
        id: "kit-1",
        name: "A kit",
        custody: { custodian: custodian(null, "Nora NRM") },
        assetKits: [],
      },
    });

    const body = await resolveAs(["BASE"]);

    expect(body.barcode.kit?.custody?.custodian).toEqual({
      userId: null,
      name: "",
      user: null,
    });
  });
});
