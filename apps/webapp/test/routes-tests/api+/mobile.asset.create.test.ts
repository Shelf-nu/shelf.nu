import Markdoc from "@markdoc/markdoc";
import { action } from "~/routes/api+/mobile+/asset.create";
import { createActionArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() function to return Response objects for React Router v7 single fetch
const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers || {}),
        },
      });
    });
});

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: createDataMock(),
  };
});

// why: external auth — we don't want to hit Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
}));

// why: external service — we don't want to hit the real database when creating assets
vi.mock("~/modules/asset/service.server", () => ({
  createAsset: vi.fn(),
}));

// why: route verifies `categoryId` belongs to the caller's org via the DB
// before trusting it. Mock the DB so tests can simulate "category exists"
// (default) and "category not in org" without hitting Postgres.
vi.mock("~/database/db.server", () => ({
  db: {
    category: {
      findFirst: vi.fn().mockResolvedValue({ id: "cat-42" }),
    },
  },
}));

// why: avoid hitting the DB to load org custom field defs; tests control the
// returned defs per-case to exercise the required-field validation contract.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn().mockResolvedValue([]),
}));

// why: spy on the validator so we can assert it received the org-scoped defs
// and the cf-{id} reshape from the mobile array contract. Default returns []
// so it acts as a pass-through that doesn't surprise the route.
vi.mock("~/utils/custom-fields", () => ({
  extractCustomFieldValuesFromPayload: vi.fn(() => []),
}));

// why: tag ids from the request are validated against the caller's org AND
// asset-assignability via the shared guard (a DB read). Mock it so tests can
// assert the route calls it and simulate the rejection without hitting Postgres.
vi.mock("~/utils/org-validation.server", () => ({
  assertTagsAssignableToAssets: vi.fn(),
}));

// why: the tag connect-set builder is a pure helper; mock it to the same shape
// so tests can assert the route forwards the org-validated tag ids to
// createAsset without loading the full tag service module.
vi.mock("~/modules/tag/service.server", () => ({
  buildTagsSet: vi.fn((tags?: string) => ({
    set: tags ? tags.split(",").map((id) => ({ id })) : [],
  })),
}));

// why: the route writes the two creation notes web writes. Mock the module so
// tests assert the note contract itself rather than exercising Prisma; the
// db mock below deliberately has no `note` model.
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn().mockResolvedValue({ id: "note-1" }),
}));

// why: the route logs a swallowed note failure; keep it off the test output.
vi.mock("~/utils/logger", () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// why: error utility — we mock to control error formatting in tests
vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
    message: cause?.message || "Unknown error",
    status: cause?.status || 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import {
  requireMobileAuth,
  requireOrganizationAccess,
  requireMobilePermission,
} from "~/modules/api/mobile-auth.server";
import { createAsset } from "~/modules/asset/service.server";
import { createNote } from "~/modules/note/service.server";
import { Logger } from "~/utils/logger";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { extractCustomFieldValuesFromPayload } from "~/utils/custom-fields";
import { assertTagsAssignableToAssets } from "~/utils/org-validation.server";
import { db } from "~/database/db.server";

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  firstName: "Test",
  lastName: "User",
};

function createRequest(
  body: Record<string, unknown>,
  { orgId = "org-1" }: { orgId?: string } = {}
) {
  const url = orgId
    ? `http://localhost/api/mobile/asset/create?orgId=${orgId}`
    : "http://localhost/api/mobile/asset/create";
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

/**
 * The shape `createAsset` actually resolves to. It includes `user` and the
 * `assetLocations` pivot, so a bare `{ id, title }` mock is a lie that lets a
 * route read an undefined field and still pass. Keep this in step with the
 * `include` in createAsset.
 */
type CreatedAsset = Awaited<ReturnType<typeof createAsset>>;

/**
 * One `assetLocations` row. The route reads `location.id`, `location.name` and
 * the row's own `quantity` (the multiplier the note phrasing uses for a
 * quantity-tracked asset), so the cast is confined here rather than repeated at
 * every call site.
 */
function assetLocationRow(
  id: string,
  name: string,
  quantity = 1
): CreatedAsset["assetLocations"][number] {
  return {
    location: { id, name },
    quantity,
  } as unknown as CreatedAsset["assetLocations"][number];
}

function createdAsset(overrides: Partial<CreatedAsset> = {}): CreatedAsset {
  return {
    id: "asset-1",
    title: "New Laptop",
    // The full User row, as createAsset's `user: true` include returns it —
    // `displayName` included, because the note wrapper prefers it and a fixture
    // without the field cannot show that the route drops it.
    user: {
      id: "user-1",
      displayName: null,
      firstName: "Carlos",
      lastName: "Virreira",
    },
    type: "INDIVIDUAL",
    unitOfMeasure: null,
    assetLocations: [],
    ...overrides,
    // The fixture carries only the fields this route reads. The single cast
    // lives here so call sites stay typed: a typo in `overrides` is a compile
    // error, which is what would have caught the missing `user` in the first
    // place.
  } as unknown as CreatedAsset;
}

/** The `content` of each note the route wrote, in the order it wrote them. */
function noteContents(): string[] {
  return vi.mocked(createNote).mock.calls.map(([args]) => args.content);
}

describe("POST /api/mobile/asset/create", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (requireMobileAuth as any).mockResolvedValue({
      user: mockUser,
      authUser: { id: "auth-user-1", email: mockUser.email },
    });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (requireMobilePermission as any).mockResolvedValue(undefined);
    (getActiveCustomFields as any).mockResolvedValue([]);
    (extractCustomFieldValuesFromPayload as any).mockReturnValue([]);
    // Default: any category referenced by tests exists in the caller's org.
    (db.category.findFirst as any).mockResolvedValue({ id: "cat-1" });
  });

  it("should create an asset and return its id and title", async () => {
    vi.mocked(createAsset).mockResolvedValue(createdAsset());

    const request = createRequest({ title: "New Laptop" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    const body = await (result as unknown as Response).json();
    expect(body.asset.id).toBe("asset-1");
    expect(body.asset.title).toBe("New Laptop");

    expect(createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Laptop",
        userId: "user-1",
        organizationId: "org-1",
      })
    );
  });

  // The point of this route change: an asset created from the phone used to
  // open with an empty history, while the same asset created on the website
  // said who made it and where they put it.
  describe("creation notes (parity with the web create route)", () => {
    it("writes the creation note naming the actor", async () => {
      vi.mocked(createAsset).mockResolvedValue(createdAsset());

      await action(
        createActionArgs({ request: createRequest({ title: "New Laptop" }) })
      );

      expect(createNote).toHaveBeenCalledWith(
        expect.objectContaining({
          content:
            'Asset was created by {% link to="/settings/team/users/user-1" text="Carlos Virreira" /%}.',
          type: "UPDATE",
          userId: "user-1",
          assetId: "asset-1",
          organizationId: "org-1",
        })
      );
    });

    it("names the location when the asset was placed", async () => {
      vi.mocked(createAsset).mockResolvedValue(
        createdAsset({
          assetLocations: [assetLocationRow("loc-1", " Warehouse A ")],
        })
      );

      await action(
        createActionArgs({
          request: createRequest({ title: "New Laptop", locationId: "loc-1" }),
        })
      );

      expect(createNote).toHaveBeenCalledTimes(2);
      expect(createNote).toHaveBeenLastCalledWith(
        expect.objectContaining({
          content:
            '{% link to="/settings/team/users/user-1" text="Carlos Virreira" /%} set the location to {% link to="/locations/loc-1" text="Warehouse A" /%}.',
          assetId: "asset-1",
        })
      );
    });

    it("still reports success when a note fails, so the phone cannot create a duplicate", async () => {
      // The asset and its activity event are committed before the notes run.
      // Answering "failed" here made the create screen offer a retry for an
      // asset that already existed - and a scanned qrId went to the retry.
      vi.mocked(createAsset).mockResolvedValue(createdAsset());
      vi.mocked(createNote).mockRejectedValueOnce(
        new Error("note insert failed")
      );

      const result = await action(
        createActionArgs({ request: createRequest({ title: "New Laptop" }) })
      );

      expect((result as unknown as Response).status).toBe(200);
      const body = await (result as unknown as Response).json();
      expect(body.asset.id).toBe("asset-1");
      expect(createAsset).toHaveBeenCalledTimes(1);
      // The other half of "fail quietly but visibly": without this assertion,
      // deleting the whole catch block from the route still passes the test.
      expect(Logger.error).toHaveBeenCalledTimes(1);
    });

    it("still writes the creation note when the location note fails", async () => {
      // Notes go out one at a time and are swallowed individually, so the note
      // that matters most can't be lost to the one that matters least.
      vi.mocked(createAsset).mockResolvedValue(
        createdAsset({
          assetLocations: [assetLocationRow("loc-1", "Warehouse A")],
        })
      );
      vi.mocked(createNote)
        .mockResolvedValueOnce({ id: "note-1" } as never)
        .mockRejectedValueOnce(new Error("note insert failed"));

      const result = await action(
        createActionArgs({
          request: createRequest({ title: "New Laptop", locationId: "loc-1" }),
        })
      );

      expect((result as unknown as Response).status).toBe(200);
      expect(createNote).toHaveBeenCalledTimes(2);
      expect(noteContents()[0]).toContain("Asset was created by");
      expect(Logger.error).toHaveBeenCalledTimes(1);
    });

    it("finishes the creation note before starting the placement note", async () => {
      // Both notes used to be issued in the same tick; two inserts landing in
      // the same millisecond let the feed (ordered by createdAt desc) show the
      // placement above the creation it describes. Asserting on overlap rather
      // than on call order — `mock.calls` is in argument order either way, so
      // it cannot tell concurrent from sequential.
      const timeline: string[] = [];
      vi.mocked(createNote).mockImplementation(async ({ content }) => {
        const label = content.includes("created by") ? "creation" : "placement";
        timeline.push(`start:${label}`);
        await new Promise((resolve) => setTimeout(resolve, 0));
        timeline.push(`end:${label}`);
        return { id: label } as never;
      });
      vi.mocked(createAsset).mockResolvedValue(
        createdAsset({
          assetLocations: [assetLocationRow("loc-1", "Warehouse A")],
        })
      );

      await action(
        createActionArgs({
          request: createRequest({ title: "New Laptop", locationId: "loc-1" }),
        })
      );

      expect(timeline).toEqual([
        "start:creation",
        "end:creation",
        "start:placement",
        "end:placement",
      ]);
    });

    it("names the user by displayName when they have set one", async () => {
      // `wrapUserLinkForNote` prefers displayName; the route used to hand-pick
      // first+last past it, renaming anyone who had one.
      vi.mocked(createAsset).mockResolvedValue(
        createdAsset({
          user: {
            id: "user-1",
            displayName: "Dr. Smith",
            firstName: "Carlos",
            lastName: "Virreira",
          },
        } as unknown as Partial<CreatedAsset>)
      );

      await action(
        createActionArgs({ request: createRequest({ title: "New Laptop" }) })
      );

      expect(createNote).toHaveBeenCalledWith(
        expect.objectContaining({
          content:
            'Asset was created by {% link to="/settings/team/users/user-1" text="Dr. Smith" /%}.',
        })
      );
    });

    it("counts the units when a quantity-tracked asset is placed", async () => {
      // The shared helper's QT phrasing. The hand-rolled sentence said "set the
      // location to X" at creation and "moved 50 boxes …" on every later move
      // of the very same asset.
      vi.mocked(createAsset).mockResolvedValue(
        createdAsset({
          type: "QUANTITY_TRACKED",
          unitOfMeasure: "boxes",
          assetLocations: [assetLocationRow("loc-1", "Warehouse A", 50)],
        } as unknown as Partial<CreatedAsset>)
      );

      await action(
        createActionArgs({
          request: createRequest({ title: "Screws", locationId: "loc-1" }),
        })
      );

      expect(createNote).toHaveBeenLastCalledWith(
        expect.objectContaining({
          content:
            '{% link to="/settings/team/users/user-1" text="Carlos Virreira" /%} placed 50 boxes at {% link to="/locations/loc-1" text="Warehouse A" /%}.',
        })
      );
    });

    // `Location.name` is free-form workspace input spliced into Markdoc note
    // content. Asserted on the PARSE rather than the string: a substring check
    // misses payloads that only become a tag after concatenation.
    it.each([
      ["closes the wrapper", 'A {% link to="javascript:alert(1)" text="x" /%}'],
      [
        "closes the tag first",
        'A /%} {% link to="javascript:alert(1)" text="x" /%}',
      ],
      [
        "pre-encodes its quotes",
        "A&quot; to=&quot;javascript:alert(1)&quot; x=&quot;",
      ],
      [
        "doubles the delimiter",
        'A{{% link to="javascript:alert(1)" text="x" /%}',
      ],
    ])(
      "cannot inject a Markdoc tag via a location name that %s",
      async (_label, evilName) => {
        vi.mocked(createAsset).mockResolvedValue(
          createdAsset({
            assetLocations: [assetLocationRow("loc-1", evilName)],
          })
        );

        await action(
          createActionArgs({
            request: createRequest({
              title: "New Laptop",
              locationId: "loc-1",
            }),
          })
        );

        const tags = [...Markdoc.parse(noteContents()[1]).walk()].filter(
          (node) => node.type === "tag"
        );
        // Exactly the two links we meant to emit, both pointing in-app — an
        // escaped payload adds a third tag or an off-site `to`.
        expect(tags).toHaveLength(2);
        for (const tag of tags) {
          expect(String(tag.attributes.to)).toMatch(/^\//);
        }
      }
    );

    it("cannot inject a Markdoc tag via a quantity-tracked asset's unit label", async () => {
      // The QT phrasing splices `unitOfMeasure` in as LITERAL text, not inside a
      // quoted attribute, so the escaping that protects the location name does
      // not cover it — `sanitizeUnitOfMeasureLabel` stripping {, % and } does.
      vi.mocked(createAsset).mockResolvedValue(
        createdAsset({
          type: "QUANTITY_TRACKED",
          unitOfMeasure: '{% link to="javascript:alert(1)" text="x" /%}',
          assetLocations: [assetLocationRow("loc-1", "Warehouse A", 50)],
        } as unknown as Partial<CreatedAsset>)
      );

      await action(
        createActionArgs({
          request: createRequest({ title: "Screws", locationId: "loc-1" }),
        })
      );

      const tags = [...Markdoc.parse(noteContents()[1]).walk()].filter(
        (node) => node.type === "tag"
      );
      expect(tags).toHaveLength(2);
      for (const tag of tags) {
        expect(String(tag.attributes.to)).toMatch(/^\//);
      }
    });

    it("writes only the creation note when the asset has no location", async () => {
      vi.mocked(createAsset).mockResolvedValue(createdAsset());

      await action(
        createActionArgs({ request: createRequest({ title: "New Laptop" }) })
      );

      expect(createNote).toHaveBeenCalledTimes(1);
    });
  });

  it("org-validates submitted tags and connects them to the new asset", async () => {
    vi.mocked(createAsset).mockResolvedValue(createdAsset({ title: "Tagged" }));

    const request = createRequest({
      title: "Tagged",
      tags: ["tag-1", "tag-2"],
    });
    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(200);
    // The org + asset-assignable guard runs with the submitted ids before connect.
    expect(assertTagsAssignableToAssets).toHaveBeenCalledWith({
      tagIds: ["tag-1", "tag-2"],
      organizationId: "org-1",
    });
    // The connect-set reaches createAsset.
    expect(createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: { set: [{ id: "tag-1" }, { id: "tag-2" }] },
      })
    );
  });

  it("rejects with 400 when a tag is not assignable to assets or not in the org", async () => {
    // why: `mockRejectedValueOnce` (not `mockRejectedValue`) — the suite's
    // beforeEach uses clearAllMocks, which clears calls but NOT a persistent
    // implementation, so a sticky reject would leak into later tests.
    (assertTagsAssignableToAssets as any).mockRejectedValueOnce({
      message:
        "Some of the selected tags can't be assigned to assets in your workspace.",
      status: 400,
    });

    const request = createRequest({
      title: "Bad tag",
      tags: ["other-org-tag"],
    });
    const result = await action(createActionArgs({ request }));

    expect((result as unknown as Response).status).toBe(400);
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("should return validation error when title is too short", async () => {
    const request = createRequest({ title: "A" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBeGreaterThanOrEqual(400);
    const body = await (result as unknown as Response).json();
    expect(body.error.message).toBeDefined();
  });

  it("should return 403 when permission is denied", async () => {
    const permError = new Error("Forbidden");
    (permError as any).status = 403;
    (requireMobilePermission as any).mockRejectedValue(permError);

    const request = createRequest({ title: "New Laptop" });
    const result = await action(createActionArgs({ request }));

    expect(result instanceof Response).toBe(true);
    expect((result as unknown as Response).status).toBe(403);
  });

  describe("required custom fields contract", () => {
    it("rejects with 400 and the field name when a required field is missing", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-serial",
          name: "Serial Number",
          required: true,
        },
      ]);

      const request = createRequest({ title: "New Laptop" });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("creates the asset when a required field is present with a non-empty value", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-serial",
          name: "Serial Number",
          required: true,
        },
      ]);
      (extractCustomFieldValuesFromPayload as any).mockReturnValue([
        { id: "cf-serial", value: { raw: "SN-123" } },
      ]);
      vi.mocked(createAsset).mockResolvedValue(createdAsset());

      const request = createRequest({
        title: "New Laptop",
        customFields: [{ id: "cf-serial", value: "SN-123" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(200);
      expect(createAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          customFieldsValues: [{ id: "cf-serial", value: { raw: "SN-123" } }],
        })
      );
    });

    it("rejects with 400 when a required field is explicitly set to null", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-serial",
          name: "Serial Number",
          required: true,
        },
      ]);

      const request = createRequest({
        title: "New Laptop",
        customFields: [{ id: "cf-serial", value: null }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("rejects with 400 when a required field is explicitly set to empty string", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-serial",
          name: "Serial Number",
          required: true,
        },
      ]);

      const request = createRequest({
        title: "New Laptop",
        customFields: [{ id: "cf-serial", value: "" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("lists every missing required field in the error message", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        { id: "cf-a", name: "Serial Number", required: true },
        { id: "cf-b", name: "Asset Tag", required: true },
        { id: "cf-c", name: "Description", required: false },
      ]);

      const request = createRequest({ title: "New Laptop" });
      const result = await action(createActionArgs({ request }));

      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Serial Number");
      expect(body.error.message).toContain("Asset Tag");
      expect(body.error.message).not.toContain("Description");
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("calls getActiveCustomFields with category: null when no categoryId is provided", async () => {
      vi.mocked(createAsset).mockResolvedValue(createdAsset({ title: "T" }));

      const request = createRequest({ title: "Test Asset" });
      await action(createActionArgs({ request }));

      expect(getActiveCustomFields).toHaveBeenCalledWith({
        organizationId: "org-1",
        category: null,
      });
    });

    it("calls getActiveCustomFields with the provided categoryId", async () => {
      vi.mocked(createAsset).mockResolvedValue(createdAsset({ title: "T" }));
      (db.category.findFirst as any).mockResolvedValue({ id: "cat-42" });

      const request = createRequest({
        title: "Test Asset",
        categoryId: "cat-42",
      });
      await action(createActionArgs({ request }));

      expect(getActiveCustomFields).toHaveBeenCalledWith({
        organizationId: "org-1",
        category: "cat-42",
      });
    });

    it("rejects with 400 'Invalid category' when categoryId is not in the caller's org", async () => {
      // why: the route verifies categoryId belongs to org via db.category
      // .findFirst — returning null means the id is unknown / cross-org.
      (db.category.findFirst as any).mockResolvedValue(null);

      const request = createRequest({
        title: "Test Asset",
        categoryId: "cat-from-another-org",
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(400);
      const body = await (result as unknown as Response).json();
      expect(body.error.message).toContain("Invalid category");
      expect(getActiveCustomFields).not.toHaveBeenCalled();
      expect(createAsset).not.toHaveBeenCalled();
    });

    it("normalises BOOLEAN required field 'true' string to boolean true", async () => {
      (getActiveCustomFields as any).mockResolvedValue([
        {
          id: "cf-active",
          name: "Active",
          type: "BOOLEAN",
          required: true,
        },
      ]);
      // Capture the payload the helper saw so we can assert the normalised value.
      let receivedPayload: Record<string, unknown> | undefined;
      (extractCustomFieldValuesFromPayload as any).mockImplementation(
        (args: { payload: Record<string, unknown> }) => {
          receivedPayload = args.payload;
          return [{ id: "cf-active", value: { raw: true } }];
        }
      );
      vi.mocked(createAsset).mockResolvedValue(createdAsset({ title: "T" }));

      const request = createRequest({
        title: "New Laptop",
        customFields: [{ id: "cf-active", value: "true" }],
      });
      const result = await action(createActionArgs({ request }));

      expect(result instanceof Response).toBe(true);
      expect((result as unknown as Response).status).toBe(200);
      expect(receivedPayload).toEqual({ "cf-cf-active": true });
    });
  });
});
