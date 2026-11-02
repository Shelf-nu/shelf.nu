/**
 * Link-format custom fields through the companion's asset update endpoint:
 * a value that is not a web link is refused with the builder's message, and a
 * link is stored in its normalized form. Runs the real value builder, unlike
 * the route's main test, which stubs it.
 *
 * @see {@link file://./../../../app/routes/api+/mobile+/asset.update.ts}
 * @see {@link file://./../../../app/utils/custom-fields.ts} buildCustomFieldValue
 */
import { createCustomField } from "@factories";
import { createActionArgs } from "@mocks/remix";
import { action } from "~/routes/api+/mobile+/asset.update";

// @vitest-environment node

// why: React Router's data() returns a non-Response object in single fetch;
// the route test reads status and JSON, so it is swapped for a Response.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  };
});

// why: bearer auth and organization access talk to Supabase and the database.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn().mockResolvedValue({
    user: { id: "user-1", email: "user@example.com" },
  }),
  requireOrganizationAccess: vi.fn().mockResolvedValue("org-1"),
  requireMobilePermission: vi.fn().mockResolvedValue(undefined),
}));

// why: the write itself needs Postgres; the test checks what reaches it.
vi.mock("~/modules/asset/service.server", () => ({
  updateAsset: vi.fn().mockResolvedValue({
    id: "asset-1",
    title: "Camera",
    description: null,
  }),
}));

// why: the definitions come from Postgres; the test supplies one Link field.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(),
}));

const { updateAsset } = await import("~/modules/asset/service.server");
const { getActiveCustomFields } = await import(
  "~/modules/custom-field/service.server"
);

// Custom field ids are cuids; the `cf-<id>` payload keys assume they hold no "-".
function updateWithManual(value: string) {
  const request = new Request(
    "http://localhost/api/mobile/asset/update?orgId=org-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId: "asset-1",
        categoryId: "uncategorized",
        customFields: [{ id: "cfmanual", value }],
      }),
    }
  );
  // why: the mocked data() above makes the action resolve to a Response.
  return action(createActionArgs({ request })) as unknown as Promise<Response>;
}

describe("POST /api/mobile/asset/update with a Link field", () => {
  beforeEach(() => {
    vi.mocked(updateAsset).mockClear();
    vi.mocked(getActiveCustomFields).mockResolvedValue([
      createCustomField({ id: "cfmanual", name: "Manual", format: "LINK" }),
    ]);
  });

  it("refuses a value that is not a web link with 400 and does not write", async () => {
    const response = await updateWithManual("see shelf");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        message:
          "Custom field 'Manual': Enter just the link, with no spaces or other text. The value we found is: 'see shelf'.",
      },
    });
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("stores a link without a scheme as an https link", async () => {
    const response = await updateWithManual("www.example.com/manual.pdf");

    expect(response.status).toBe(200);
    expect(updateAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        customFieldsValues: [
          {
            id: "cfmanual",
            value: {
              raw: "https://www.example.com/manual.pdf",
              valueText: "https://www.example.com/manual.pdf",
            },
          },
        ],
      })
    );
  });
});
