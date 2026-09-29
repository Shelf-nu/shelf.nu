// @vitest-environment node
/**
 * Public QR page (`/qr/:qrId`): the scan it records.
 *
 * A phone camera and the web scanner's QR "View asset" both land here. Every
 * hit records a `QR_LINK` scan stamped with the asset or kit and workspace the
 * QR points at, with a note on the asset, before any redirect: even a
 * signed-out visitor's scan is kept, with no user.
 *
 * @see {@link file://./../../../../app/routes/qr+/_public+/$qrId.tsx}
 */

const { mockGetQr } = vi.hoisted(() => ({ mockGetQr: vi.fn() }));
// why: the QR lookup reads the database.
vi.mock("~/modules/qr/service.server", () => ({ getQr: mockGetQr }));

const { mockRecordScan, mockUpdateScan } = vi.hoisted(() => ({
  mockRecordScan: vi.fn(),
  mockUpdateScan: vi.fn(),
}));
// why: recording writes to the database; its own behaviour is covered in
// record-scan.test.ts. Here we assert what the route asks it for.
vi.mock("~/modules/scan/service.server", () => ({
  recordScan: mockRecordScan,
  updateScan: mockUpdateScan,
  updateScanGeolocation: vi.fn(),
}));

// why: the caller's workspaces are read from the database.
vi.mock("~/modules/organization/service.server", () => ({
  getUserOrganizations: vi
    .fn()
    .mockResolvedValue([
      { organization: { id: "org-1", type: "TEAM" } },
      { organization: { id: "org-p", type: "PERSONAL" } },
    ]),
}));

// why: the workspace cookie is signed with the session secret, which unit
// tests do not carry; its value is not under test.
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("org=org-1"),
}));

// why: importing the route pulls in `db.server`, whose initialization would
// otherwise open a real PostgreSQL connection.
vi.mock("~/database/db.server", () => ({ db: { $connect: vi.fn() } }));

import { loader } from "~/routes/qr+/_public+/$qrId";

/** Runs the loader for `qr-1`, signed in or not. */
async function open({ signedIn }: { signedIn: boolean }) {
  return (await loader({
    request: new Request("http://localhost/qr/qr-1", {
      headers: { "user-agent": "Mozilla/5.0" },
    }),
    params: { qrId: "qr-1" },
    context: {
      isAuthenticated: signedIn,
      getSession: () => ({ userId: "user-1" }),
    },
  } as unknown as Parameters<typeof loader>[0])) as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRecordScan.mockResolvedValue({ id: "scan-1" });
  mockGetQr.mockResolvedValue({
    id: "qr-1",
    assetId: "asset-1",
    kitId: null,
    organizationId: "org-1",
  });
});

describe("GET /qr/:qrId records the scan", () => {
  it("records a QR link scan against the asset, with a note", async () => {
    const response = await open({ signedIn: true });

    expect(mockRecordScan).toHaveBeenCalledWith({
      codeType: "QR",
      code: "qr-1",
      source: "QR_LINK",
      userAgent: "Mozilla/5.0",
      userId: "user-1",
      qrId: "qr-1",
      assetId: "asset-1",
      kitId: null,
      organizationId: "org-1",
      writeNote: true,
    });
    // The new row's id rides the redirect for the geolocation post.
    expect(response.headers.get("Location")).toContain("scanId=scan-1");
  });

  it("records a signed-out visitor's scan as anonymous", async () => {
    await open({ signedIn: false });

    expect(mockRecordScan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "anonymous", source: "QR_LINK" })
    );
  });

  it("records a scan of a QR nobody has claimed, with no workspace", async () => {
    mockGetQr.mockResolvedValue({
      id: "qr-1",
      assetId: null,
      kitId: null,
      organizationId: null,
    });

    await open({ signedIn: true });

    expect(mockRecordScan).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null, assetId: null })
    );
  });
});
