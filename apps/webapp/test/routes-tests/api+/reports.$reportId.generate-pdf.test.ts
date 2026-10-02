// @vitest-environment node
/**
 * The report PDFs' data loader, `api+/reports.$reportId.generate-pdf`, as far
 * as usage counting goes: every printable sheet sends one `pdf_preview_opened`
 * event when its preview is generated, and a report's names which report.
 *
 * @see {@link file://./../../../app/routes/api+/reports.$reportId.generate-pdf.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import { custodySnapshotReport } from "~/modules/reports/helpers.server";
import { loader } from "~/routes/api+/reports.$reportId.generate-pdf";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so the loader can be invoked directly,
// with no router runtime to stand up.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: each test supplies the workspace the permission check resolves to,
// rather than running the real permission machinery.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: external database; the loader reads the workspace's name and currency.
vi.mock("~/database/db.server", () => ({
  db: { organization: { findUnique: vi.fn() } },
}));

// why: the report queries are large database reads with their own tests; this
// suite is about the loader's event. `resolveTimeframe` stays real.
vi.mock("~/modules/reports/helpers.server", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "~/modules/reports/helpers.server"
  );
  return {
    ...actual,
    bookingComplianceReport: vi.fn(),
    assetInventoryReport: vi.fn(),
    custodySnapshotReport: vi.fn(),
  };
});

// why: reads the acting user's saved format preferences from the database.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  }),
}));

// why: PostHog is an external service; record what would be sent.
vi.mock("~/integrations/posthog/client.server", () => ({
  captureServerEvent: vi.fn(),
}));

/** One custody row, as the report query returns it. */
function custodyRow(assetId: string) {
  return {
    assetId,
    assetName: "Laptop",
    category: null,
    location: null,
    custodianName: "Ada",
    assignedAt: new Date("2026-01-01T00:00:00.000Z"),
    daysInCustody: 3,
    valuation: null,
    quantity: 1,
  };
}

function buildArgs(): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(
      "https://example.com/api/reports/custody-snapshot/generate-pdf"
    ),
    params: { reportId: "custody-snapshot" },
  } as unknown as LoaderFunctionArgs;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    role: "ADMIN",
  } as never);
  vi.mocked(db.organization.findUnique).mockResolvedValue({
    name: "Org",
    imageId: null,
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    currency: "USD",
  } as never);
  vi.mocked(custodySnapshotReport).mockResolvedValue({
    rows: [custodyRow("asset-1"), custodyRow("asset-2"), custodyRow("asset-3")],
    totalRows: 3,
  } as never);
});

describe("report PDF loader", () => {
  it("counts one opened preview, naming the report and its row count", async () => {
    const response = (await loader(buildArgs())) as unknown as Response;
    expect(response.status).toBe(200);

    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "pdf_preview_opened",
      properties: {
        sheet: "report",
        organizationId: "org-1",
        rowCount: 3,
        reportId: "custody-snapshot",
      },
    });
  });
});
