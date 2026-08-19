/**
 * What the audit receipt is allowed to leave out.
 *
 * why this test exists: the receipt is the audit's OUTPUT — the artifact
 * somebody keeps, attaches to a claim, or hands to a client. It used to read
 * every `AuditNote` with one query and `take: 15`. `AuditNote` mixes two
 * unrelated things: the condition notes people typed, and the system trail,
 * which grows with every scan. So on any audit past a handful of assets the
 * trail won the fifteen slots and the observations fell off the record with no
 * warning anywhere.
 *
 * Truncating the trail is fine — it is a convenience summary. Truncating what
 * somebody wrote about a damaged asset is data loss, and it is silent, which
 * is why it needs a test rather than a comment.
 *
 * @see {@link file://./pdf-helpers.ts}
 * @see {@link file://./../../components/audit/audit-receipt-pdf.tsx}
 */
// @vitest-environment node

// why: external database — don't hit the real DB
vi.mock("~/database/db.server", () => ({
  db: {
    auditSession: { findUnique: vi.fn() },
    auditAsset: { findMany: vi.fn() },
    auditImage: { findMany: vi.fn() },
    auditNote: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}));

// why: signing QR images reaches Supabase storage; irrelevant to note queries
vi.mock("~/modules/qr/service.server", () => ({
  getQrCodeMaps: vi.fn().mockResolvedValue({}),
}));

import { db } from "~/database/db.server";
import { fetchAllAuditPdfRelatedData } from "~/modules/audit/pdf-helpers";

const SESSION = {
  id: "audit-1",
  name: "Quarterly check",
  status: "COMPLETED",
  organizationId: "org-1",
  createdBy: { firstName: "Ada", lastName: "L", email: "ada@example.com" },
  assignments: [],
};

/** The note query for a given `type`, as it was actually issued. */
function noteQueryFor(type: "COMMENT" | "UPDATE") {
  const calls = (db.auditNote.findMany as ReturnType<typeof vi.fn>).mock.calls;
  return calls.map((c) => c[0]).find((arg) => arg?.where?.type === type);
}

describe("audit receipt — what it may truncate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (db.auditSession.findUnique as any).mockResolvedValue(SESSION);
    (db.auditAsset.findMany as any).mockResolvedValue([]);
    (db.auditImage.findMany as any).mockResolvedValue([]);
    (db.auditNote.findMany as any).mockResolvedValue([]);
    (db.asset.findMany as any).mockResolvedValue([]);
    (db.organization.findUnique as any).mockResolvedValue({
      id: "org-1",
      name: "Org",
    });

    await fetchAllAuditPdfRelatedData(
      "audit-1",
      "org-1",
      "user-1",
      undefined,
      new Request("http://localhost/x")
    );
  });

  it("asks for condition notes and system activity separately", () => {
    // why: one query for both is what made the loss possible. Two queries is
    // the structural fix; everything below only holds because of it.
    expect(db.auditNote.findMany).toHaveBeenCalledTimes(2);
    expect(noteQueryFor("COMMENT")).toBeTruthy();
    expect(noteQueryFor("UPDATE")).toBeTruthy();
  });

  it("never caps the condition notes", () => {
    // why: this is the whole point. A receipt that quietly drops the
    // twenty-first observation is worse than one that shows none, because it
    // looks complete. If a cap is ever added here it must be a deliberate
    // decision that changes this line, not a default that nobody noticed.
    const q = noteQueryFor("COMMENT");

    expect(q).not.toHaveProperty("take");
    expect(q?.where).toMatchObject({
      auditSessionId: "audit-1",
      type: "COMMENT",
    });
  });

  it("reads condition notes oldest first, so the receipt tells a story", () => {
    // why: the feed on screen is newest-first because it is a feed. A printed
    // record is read top to bottom in the order the audit happened.
    expect(noteQueryFor("COMMENT")?.orderBy).toEqual({ createdAt: "asc" });
  });

  it("carries each note's asset, so a note prints beside its photos", () => {
    // why: a note about an asset and a photo of that asset are one
    // observation. Without the asset on the note the receipt cannot group
    // them and the reader rejoins them by name across sections.
    expect(noteQueryFor("COMMENT")?.include).toHaveProperty("auditAsset");
  });

  it("still caps the system activity, which is a summary and may truncate", () => {
    // why: the trail grows without bound and nobody needs all of it in a
    // receipt. Keeping the cap HERE is what lets the notes go uncapped.
    const q = noteQueryFor("UPDATE");

    expect(q?.take).toBe(15);
    expect(q?.orderBy).toEqual({ createdAt: "desc" });
  });
});
