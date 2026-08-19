import { loader } from "~/routes/api+/mobile+/audits.$auditId.evidence";
import { createLoaderArgs } from "@mocks/remix";

// @vitest-environment node

// why: mocking Remix's data() so the loader returns real Response objects
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
  return { ...actual, data: createDataMock() };
});

// why: external auth — no Supabase in tests
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findFirst: vi.fn() },
    auditNote: { findMany: vi.fn() },
    auditImage: { findMany: vi.fn() },
  },
}));

vi.mock("~/utils/error", () => ({
  makeShelfError: vi.fn((cause: any) => ({
    message: cause?.message ?? "error",
    status: cause?.status ?? 500,
  })),
  ShelfError: class ShelfError extends Error {
    status: number;
    constructor(opts: any) {
      super(opts.message);
      this.status = opts.status || 500;
    }
  },
}));

import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";

const mockDb = db as unknown as {
  auditSession: { findFirst: ReturnType<typeof vi.fn> };
  auditNote: { findMany: ReturnType<typeof vi.fn> };
  auditImage: { findMany: ReturnType<typeof vi.fn> };
};

function request(qs = "orgId=org-1") {
  return new Request(
    `http://localhost/api/mobile/audits/audit-1/evidence?${qs}`,
    { headers: { Authorization: "Bearer token" } }
  );
}

const ARGS = { params: { auditId: "audit-1" } };

/** Parses the loader's mocked Response body. */
async function body(res: unknown) {
  return await (res as unknown as Response).json();
}

const NOTE_GENERAL = {
  id: "note-general",
  content: "All three located. Two need follow-up.",
  createdAt: new Date("2026-08-19T12:42:00.000Z"),
  auditAssetId: null,
  user: { firstName: "John", lastName: "Doe", profilePicture: "j.png" },
};

const NOTE_ASSET = {
  id: "note-asset",
  content: "Lens ring stiff when focusing.",
  createdAt: new Date("2026-08-19T12:33:00.000Z"),
  auditAssetId: "aa-1",
  user: { firstName: "John", lastName: "Doe", profilePicture: null },
};

const IMAGE_GENERAL = {
  id: "img-general",
  imageUrl: "https://x/full-rack.jpg",
  thumbnailUrl: "https://x/thumb-rack.jpg",
  description: "Rack before the sweep",
  createdAt: new Date("2026-08-19T12:42:00.000Z"),
  auditAssetId: null,
  uploadedBy: { firstName: "John", lastName: "Doe", profilePicture: null },
};

const IMAGE_ASSET = {
  id: "img-asset",
  imageUrl: "https://x/full-arri.jpg",
  // why: deliberately null — the route must fall back to imageUrl rather
  // than send null into a thumbnail grid.
  thumbnailUrl: null,
  description: null,
  createdAt: new Date("2026-08-19T12:34:00.000Z"),
  auditAssetId: "aa-1",
  uploadedBy: null,
};

describe("GET /api/mobile/audits/:auditId/evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireMobileAuth as any).mockResolvedValue({ user: { id: "user-1" } });
    (requireOrganizationAccess as any).mockResolvedValue("org-1");
    (getMobileUserContext as any).mockResolvedValue({
      role: "ADMIN",
      canUseAudits: true,
    });
    mockDb.auditSession.findFirst.mockResolvedValue({ id: "audit-1" });
    mockDb.auditNote.findMany.mockResolvedValue([]);
    mockDb.auditImage.findMany.mockResolvedValue([]);
  });

  describe("splitting the two buckets", () => {
    it("puts rows with no auditAssetId in `general` and the rest under their asset", async () => {
      // why: this split is the whole contract. The completion note belongs to
      // the audit; a condition note belongs to one asset. Merging them would
      // show a photo of one lens as if it described the whole sweep.
      mockDb.auditNote.findMany.mockResolvedValue([NOTE_GENERAL, NOTE_ASSET]);
      mockDb.auditImage.findMany.mockResolvedValue([
        IMAGE_GENERAL,
        IMAGE_ASSET,
      ]);

      const res = await loader(
        createLoaderArgs({ request: request(), ...ARGS })
      );
      const json = await body(res);

      expect(json.general.notes.map((n: any) => n.id)).toEqual([
        "note-general",
      ]);
      expect(json.general.images.map((i: any) => i.id)).toEqual([
        "img-general",
      ]);
      expect(json.byAuditAsset["aa-1"].notes.map((n: any) => n.id)).toEqual([
        "note-asset",
      ]);
      expect(json.byAuditAsset["aa-1"].images.map((i: any) => i.id)).toEqual([
        "img-asset",
      ]);
      // A general row must never leak into an asset bucket.
      expect(json.byAuditAsset["aa-1"].notes).toHaveLength(1);
    });

    it("keys buckets by auditAssetId, which is what the detail payload carries", async () => {
      mockDb.auditNote.findMany.mockResolvedValue([
        NOTE_ASSET,
        { ...NOTE_ASSET, id: "note-other", auditAssetId: "aa-2" },
      ]);

      const res = await loader(
        createLoaderArgs({ request: request(), ...ARGS })
      );
      const json = await body(res);

      expect(Object.keys(json.byAuditAsset).sort()).toEqual(["aa-1", "aa-2"]);
    });
  });

  describe("serialisation", () => {
    it("falls back to the full image when a thumbnail is missing", async () => {
      // why: a null thumbnail in a thumbnail grid renders as a gap where a
      // photo plainly exists.
      mockDb.auditImage.findMany.mockResolvedValue([IMAGE_ASSET]);

      const json = await body(
        await loader(createLoaderArgs({ request: request(), ...ARGS }))
      );

      expect(json.byAuditAsset["aa-1"].images[0].thumbnailUrl).toBe(
        "https://x/full-arri.jpg"
      );
    });

    it("returns a null author when the account is gone, rather than dropping the row", async () => {
      // why: evidence outlives the person who recorded it. Losing the row
      // would lose the audit trail.
      mockDb.auditImage.findMany.mockResolvedValue([IMAGE_ASSET]);

      const json = await body(
        await loader(createLoaderArgs({ request: request(), ...ARGS }))
      );

      expect(json.byAuditAsset["aa-1"].images).toHaveLength(1);
      expect(json.byAuditAsset["aa-1"].images[0].authorName).toBeNull();
    });

    it("composes the author name and serialises dates as ISO strings", async () => {
      mockDb.auditNote.findMany.mockResolvedValue([NOTE_GENERAL]);

      const json = await body(
        await loader(createLoaderArgs({ request: request(), ...ARGS }))
      );

      expect(json.general.notes[0].authorName).toBe("John Doe");
      expect(json.general.notes[0].createdAt).toBe("2026-08-19T12:42:00.000Z");
    });
  });

  describe("guards", () => {
    it("404s for an audit outside the caller's workspace, without reading evidence", async () => {
      // why: proves a guessed id from another org cannot be probed here.
      mockDb.auditSession.findFirst.mockResolvedValue(null);

      const res = await loader(
        createLoaderArgs({ request: request(), ...ARGS })
      );

      expect((res as unknown as Response).status).toBe(404);
      expect(mockDb.auditNote.findMany).not.toHaveBeenCalled();
      expect(mockDb.auditImage.findMany).not.toHaveBeenCalled();
    });

    it("403s when audits are not enabled for the workspace", async () => {
      (getMobileUserContext as any).mockResolvedValue({
        role: "ADMIN",
        canUseAudits: false,
      });

      const res = await loader(
        createLoaderArgs({ request: request(), ...ARGS })
      );

      expect((res as unknown as Response).status).toBe(403);
      expect(mockDb.auditSession.findFirst).not.toHaveBeenCalled();
    });

    it("scopes the image query to the organization", async () => {
      await loader(createLoaderArgs({ request: request(), ...ARGS }));

      expect(mockDb.auditImage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { auditSessionId: "audit-1", organizationId: "org-1" },
        })
      );
    });

    it("asks only for COMMENT notes, not the system activity trail", async () => {
      // why: `AuditNote` mixes human comments with UPDATE rows written as
      // MARKDOC SOURCE (`{% link to="/settings/team/users/..." /%}`). The web
      // feed renders those through MarkdownViewer; the phone has no Markdoc
      // renderer, so an unfiltered query paints raw tag source into the sheet.
      // Found against a real workspace holding 9 UPDATE rows and 1 COMMENT.
      await loader(createLoaderArgs({ request: request(), ...ARGS }));

      expect(mockDb.auditNote.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { auditSessionId: "audit-1", type: "COMMENT" },
        })
      );
    });
  });
});
