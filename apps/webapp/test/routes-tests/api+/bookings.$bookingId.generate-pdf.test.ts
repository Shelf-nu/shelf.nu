// @vitest-environment node
/**
 * The booking checklist's data loader, `api+/bookings.$bookingId.generate-pdf`.
 *
 * Two things happen here and nowhere else. Lapsed asset photos are signed for
 * print, so the template prints every photo instead of a placeholder. And the preview is
 * counted: printing happens in the browser, so the loader, which runs when the
 * preview opens, is the only place the server sees the template being used.
 *
 * @see {@link file://./../../../app/routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionContext } from "@helpers/role-access";

import { captureServerEvent } from "~/integrations/posthog/client.server";
import { signAssetPhotosForPrint } from "~/modules/asset/print-images.server";
import { refreshExpiredAssetImages } from "~/modules/asset/service.server";
import { fetchAllPdfRelatedData } from "~/modules/booking/pdf-helpers";
import {
  BOOKING_CHECKLIST_CONFIG,
  CHECKOUT_RECEIPT_CONFIG,
} from "~/modules/pdf-template/config";
import { resolvePdfTemplateForPrint } from "~/modules/pdf-template/service.server";
import { loader } from "~/routes/api+/bookings.$bookingId.generate-pdf";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so the loader can be invoked directly,
// with no router runtime to stand up.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers as Record<string, string> | undefined),
          },
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

// why: the template's data is a large database read with its own tests
// (`modules/booking/pdf-helpers.test.ts`); this suite is about the loader.
vi.mock("~/modules/booking/pdf-helpers", () => ({
  fetchAllPdfRelatedData: vi.fn(),
}));

// why: signing talks to storage. The stub stands in for storage handing back
// a fresh URL, so the test can see the fresh rows reach the response.
vi.mock("~/modules/asset/print-images.server", () => ({
  signAssetPhotosForPrint: vi.fn(),
}));

// why: stands in for the persisting re-sign, so the test can prove the
// loader never uses it (it writes back and bumps `Asset.updatedAt`).
vi.mock("~/modules/asset/service.server", () => ({
  refreshExpiredAssetImages: vi.fn(),
}));

// why: reads the acting user's saved format preferences from the database.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  }),
}));

// why: reads the workspace's templates from the database; the template rules have
// their own tests (`modules/pdf-template/service.server.test.ts`).
vi.mock("~/modules/pdf-template/service.server", () => ({
  resolvePdfTemplateForPrint: vi.fn(),
}));

// why: PostHog is an external service; record what would be sent.
vi.mock("~/integrations/posthog/client.server", () => ({
  captureServerEvent: vi.fn(),
}));

/**
 * Three rows of the template, the first with a lapsed photo. Rows are booking
 * slices, so `asset-1` prints twice: three rows, two assets.
 */
const ROWS = [
  {
    id: "asset-1",
    bookingAssetId: "ba-1",
    mainImage: "https://storage/lapsed.jpg",
  },
  { id: "asset-2", bookingAssetId: "ba-2", mainImage: null },
  { id: "asset-1", bookingAssetId: "ba-3", mainImage: null },
];

const CHECKLIST = {
  id: "template-checklist",
  name: "Checklist",
  isDefault: true,
  config: BOOKING_CHECKLIST_CONFIG,
};
const CHECKOUT_RECEIPT = {
  id: "template-check-out-receipt",
  name: "Check-out receipt",
  isDefault: false,
  config: CHECKOUT_RECEIPT_CONFIG,
};

function buildArgs({
  query = "",
  cookie,
  userId = "user-1",
}: {
  query?: string;
  cookie?: string;
  userId?: string;
} = {}): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId }) },
    request: new Request(
      `https://example.com/api/bookings/booking-1/generate-pdf${query}`,
      { headers: cookie ? { Cookie: cookie } : {} }
    ),
    params: { bookingId: "booking-1" },
  } as unknown as LoaderFunctionArgs;
}

/**
 * A `requirePermission` result for a workspace of the given type. Templates
 * belong to team workspaces, so the type decides whether a print reads them.
 */
function inWorkspace(type: "TEAM" | "PERSONAL", context = permissionContext()) {
  return {
    ...context,
    currentOrganization: { ...context.currentOrganization, type },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(inWorkspace("TEAM") as never);
  vi.mocked(fetchAllPdfRelatedData).mockResolvedValue({
    booking: { from: null, to: null, originalFrom: null, originalTo: null },
    assets: ROWS,
  } as never);
  // Answers like the real lookup: the requested template, else the
  // remembered one, else the default.
  vi.mocked(resolvePdfTemplateForPrint).mockImplementation(
    async ({ requestedId, rememberedId }) => {
      const templates = [CHECKLIST, CHECKOUT_RECEIPT];
      const template =
        templates.find((d) => d.id === (requestedId ?? rememberedId)) ??
        CHECKLIST;
      return { template, templates };
    }
  );
  vi.mocked(signAssetPhotosForPrint).mockImplementation(
    async (rows) =>
      rows.map((row) =>
        row.mainImage ? { ...row, mainImage: "https://storage/fresh.jpg" } : row
      ) as never
  );
});

describe("booking checklist loader", () => {
  it("hands the caller's access to the data read, which runs the ownership check", async () => {
    const context = inWorkspace("TEAM", permissionContext({ roles: ["BASE"] }));
    vi.mocked(requirePermission).mockResolvedValue(context as never);

    await loader(buildArgs());

    expect(vi.mocked(fetchAllPdfRelatedData).mock.calls[0][3]).toBe(
      context.access
    );
  });

  it("signs lapsed photos for print, without the persisting re-sign, before the template gets them", async () => {
    const response = (await loader(buildArgs())) as unknown as Response;
    const body = await response.json();

    expect(signAssetPhotosForPrint).toHaveBeenCalledWith(ROWS, {
      organizationId: "org-1",
    });
    expect(refreshExpiredAssetImages).not.toHaveBeenCalled();
    // why: signing is only useful if the fresh URL is what gets printed.
    expect(body.pdfMeta.assets[0].mainImage).toBe("https://storage/fresh.jpg");
  });

  it("counts one opened preview, with its printed rows and distinct assets", async () => {
    await loader(buildArgs());

    expect(captureServerEvent).toHaveBeenCalledTimes(1);
    expect(captureServerEvent).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "pdf_preview_opened",
      properties: {
        sheet: "booking_checklist",
        documentId: "template-checklist",
        documentName: "Checklist",
        organizationId: "org-1",
        rowCount: 3,
        assetCount: 2,
      },
    });
  });

  it("counts no new preview when the person picks another template", async () => {
    await loader(buildArgs({ query: "?template=template-check-out-receipt" }));

    expect(captureServerEvent).not.toHaveBeenCalled();
  });

  it("counts nothing when the template could not be built", async () => {
    vi.mocked(fetchAllPdfRelatedData).mockRejectedValue(new Error("boom"));

    const response = (await loader(buildArgs())) as unknown as Response;

    expect(response.status).toBe(500);
    expect(captureServerEvent).not.toHaveBeenCalled();
  });
});

describe("booking template loader: which template prints", () => {
  it("hands the requested template to the workspace-scoped lookup and returns it with the list", async () => {
    vi.mocked(resolvePdfTemplateForPrint).mockResolvedValue({
      template: CHECKOUT_RECEIPT,
      templates: [CHECKLIST, CHECKOUT_RECEIPT],
    });

    const response = (await loader(
      buildArgs({ query: "?template=template-check-out-receipt" })
    )) as unknown as Response;
    const body = await response.json();

    expect(resolvePdfTemplateForPrint).toHaveBeenCalledWith({
      organizationId: "org-1",
      requestedId: "template-check-out-receipt",
      rememberedId: null,
    });
    expect(body.template).toEqual({
      id: "template-check-out-receipt",
      name: "Check-out receipt",
      config: CHECKOUT_RECEIPT_CONFIG,
    });
    expect(body.templates).toEqual([
      { id: "template-checklist", name: "Checklist", isDefault: true },
      {
        id: "template-check-out-receipt",
        name: "Check-out receipt",
        isDefault: false,
      },
    ]);
  });

  it("answers 404 for a template outside the workspace, and reads no booking data", async () => {
    vi.mocked(resolvePdfTemplateForPrint).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "This template does not exist in your workspace.",
        label: "PDF templates",
        status: 404,
        shouldBeCaptured: false,
      })
    );

    const response = (await loader(
      buildArgs({ query: "?template=template-of-another-workspace" })
    )) as unknown as Response;

    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe(
      "This template does not exist in your workspace."
    );
    expect(fetchAllPdfRelatedData).not.toHaveBeenCalled();
  });

  it("remembers an explicit pick for this person and workspace, and offers it next time", async () => {
    const picked = (await loader(
      buildArgs({ query: "?template=template-check-out-receipt" })
    )) as unknown as Response;
    const setCookie = picked.headers.get("Set-Cookie");
    expect(setCookie).toMatch(/^org-1_pdf_template=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    vi.mocked(resolvePdfTemplateForPrint).mockClear();
    await loader(buildArgs({ cookie: setCookie!.split(";")[0] }));

    expect(resolvePdfTemplateForPrint).toHaveBeenCalledWith({
      organizationId: "org-1",
      requestedId: null,
      rememberedId: "template-check-out-receipt",
    });
  });

  it("ignores a remembered pick of another person or another workspace", async () => {
    const picked = (await loader(
      buildArgs({ query: "?template=template-check-out-receipt" })
    )) as unknown as Response;
    const cookie = picked.headers.get("Set-Cookie")!.split(";")[0];

    vi.mocked(resolvePdfTemplateForPrint).mockClear();
    await loader(buildArgs({ cookie, userId: "user-2" }));
    expect(resolvePdfTemplateForPrint).toHaveBeenLastCalledWith(
      expect.objectContaining({ rememberedId: null })
    );

    vi.mocked(requirePermission).mockResolvedValue(
      inWorkspace(
        "TEAM",
        permissionContext({ organizationId: "org-2" })
      ) as never
    );
    await loader(buildArgs({ cookie }));
    expect(resolvePdfTemplateForPrint).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: "org-2", rememberedId: null })
    );
  });

  it("only sends the cookie back to the booking PDF route", async () => {
    const picked = (await loader(
      buildArgs({ query: "?template=template-check-out-receipt" })
    )) as unknown as Response;

    expect(picked.headers.get("Set-Cookie")).toMatch(/Path=\/api\/bookings/);
  });

  it("sets no cookie when the server picked the template", async () => {
    const response = (await loader(buildArgs())) as unknown as Response;

    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("prints a name-sorted template A to Z, whatever the booking page is sorted by", async () => {
    vi.mocked(resolvePdfTemplateForPrint).mockResolvedValue({
      template: CHECKOUT_RECEIPT,
      templates: [CHECKLIST, CHECKOUT_RECEIPT],
    });

    await loader(buildArgs({ query: "?orderBy=category&orderDirection=desc" }));

    expect(vi.mocked(fetchAllPdfRelatedData).mock.calls[0][5]).toMatchObject({
      orderBy: "title",
      orderDirection: "asc",
    });
  });

  it("prints a status-sorted template in the booking page's order", async () => {
    await loader(buildArgs({ query: "?orderBy=category&orderDirection=asc" }));

    expect(vi.mocked(fetchAllPdfRelatedData).mock.calls[0][5]).toMatchObject({
      orderBy: "category",
      orderDirection: "asc",
    });
  });

  it("signs no photos for a template that prints no Image column", async () => {
    vi.mocked(resolvePdfTemplateForPrint).mockResolvedValue({
      template: {
        ...CHECKLIST,
        config: {
          ...BOOKING_CHECKLIST_CONFIG,
          columns: { ...BOOKING_CHECKLIST_CONFIG.columns, image: false },
        },
      },
      templates: [CHECKLIST],
    });

    await loader(buildArgs());

    expect(signAssetPhotosForPrint).not.toHaveBeenCalled();
  });

  it("asks for the template's custom fields, with the user's date format", async () => {
    vi.mocked(resolvePdfTemplateForPrint).mockResolvedValue({
      template: {
        ...CHECKLIST,
        config: { ...BOOKING_CHECKLIST_CONFIG, customFieldIds: ["cf-price"] },
      },
      templates: [CHECKLIST],
    });

    await loader(buildArgs());

    expect(vi.mocked(fetchAllPdfRelatedData).mock.calls[0][6]).toEqual({
      customFieldIds: ["cf-price"],
      formatPrefs: expect.objectContaining({ dateFormat: "DD_MM_YYYY" }),
    });
  });
});

describe("booking PDF loader: a personal workspace", () => {
  beforeEach(() => {
    vi.mocked(requirePermission).mockResolvedValue(
      inWorkspace("PERSONAL") as never
    );
  });

  it("prints the Checklist without reading, or seeding, any template", async () => {
    const response = (await loader(
      buildArgs({ query: "?template=template-check-out-receipt" })
    )) as unknown as Response;
    const body = await response.json();

    expect(resolvePdfTemplateForPrint).not.toHaveBeenCalled();
    expect(captureServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          documentId: null,
          documentName: null,
        }),
      })
    );
    expect(body.template).toBeNull();
    expect(body.templates).toEqual([]);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(vi.mocked(fetchAllPdfRelatedData).mock.calls[0][6]).toEqual({
      customFieldIds: [],
      formatPrefs: expect.objectContaining({ dateFormat: "DD_MM_YYYY" }),
    });
  });
});
