// @vitest-environment node
// why: the job tests run the real undici-backed fetch path through MSW;
// happy-dom would shadow Response and ignore the guarded dispatcher.
/**
 * Tests for the link preview service: which links `getLinkTitles` reads and
 * which it claims (due rows only, capped per read),
 * that it returns without waiting for the claim, the claim SQL it sends, that
 * queue and database failures never reach the loader, and what
 * `runLinkPreviewJob` records for a fetched page.
 *
 * The claim's concurrency guarantee (two readers claim a row once) is proven
 * against a real database in `service.db.test.ts`; here the SQL text is
 * pinned.
 *
 * @see {@link file://./service.server.ts}
 */
import type { Prisma } from "@prisma/client";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "@mocks";

import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";
import { scheduler } from "~/utils/scheduler.server";
import { getLinkTitles, runLinkPreviewJob } from "./service.server";
import type { LinkTitleSource } from "./service.server";

// why: LinkPreview rows live in the database; each test sets what it returns
// and asserts what the service wrote.
vi.mock("~/database/db.server", () => ({
  db: {
    $queryRaw: vi.fn(),
    linkPreview: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

// why: pg-boss needs a database connection; the job sent is the contract.
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { linkPreviewQueue: "link-preview-queue" },
  scheduler: { send: vi.fn() },
}));

// why: keeps failure logs out of the output so tests can assert on them.
vi.mock("~/utils/logger", () => ({
  Logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const ORG = "org-1";
const MANUAL = "https://www.example-maker.com/manuals/eos-r5";
const SHEET = "https://contoso.sharepoint.com/:x:/s/Lab/EcAl26?e=k3";
const SHOP = "https://www.example-shop.com/c/product/1234";

/** A TEXT custom field value. */
function text(raw: string): LinkTitleSource {
  return {
    value: { raw, valueText: raw },
    customField: { type: "TEXT" },
  };
}

/** A LinkPreview row as `findMany` selects it. */
function row(
  url: string,
  fields: Partial<{
    pageTitle: string | null;
    customTitle: string | null;
    nextFetchAt: Date | null;
  }> = {}
) {
  return {
    url,
    pageTitle: null,
    customTitle: null,
    nextFetchAt: null,
    ...fields,
  };
}

/** The claim query `getLinkTitles` sent, or undefined when it sent none. */
function claimQuery(): Prisma.Sql | undefined {
  return vi.mocked(db.$queryRaw).mock.calls[0]?.[0] as Prisma.Sql | undefined;
}

/**
 * Lets the claim `getLinkTitles` starts without waiting finish: its query and
 * queue calls are mocked promises, settled once pending I/O callbacks run.
 */
function settleClaim() {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.linkPreview.findMany).mockResolvedValue([]);
  vi.mocked(db.$queryRaw).mockResolvedValue([]);
  vi.mocked(scheduler.send).mockResolvedValue("job-id");
});

describe("getLinkTitles: reading", () => {
  it("returns titles keyed by LinkKey for links in TEXT values of any field", async () => {
    vi.mocked(db.linkPreview.findMany).mockResolvedValue([
      row(MANUAL, { pageTitle: "EOS R5 user manual" }),
      row(SHEET, { customTitle: "Lab calibration log" }),
      row(SHOP),
    ] as never);

    const titles = await getLinkTitles({
      organizationId: ORG,
      values: [
        // The key drops the fragment, so this reads the MANUAL row.
        text(`${MANUAL}#page=3`),
        text(SHEET),
        text(SHOP),
        // Text around a URL is not one link, and only TEXT values are read.
        text("Manual: https://www.example.com/a (rev B)"),
        {
          value: { raw: "https://www.example.com/b", valueMultiLineText: {} },
          customField: { type: "MULTILINE_TEXT" },
        },
      ],
    });

    expect(db.linkPreview.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, url: { in: [MANUAL, SHEET, SHOP] } },
      select: {
        url: true,
        pageTitle: true,
        customTitle: true,
        nextFetchAt: true,
      },
    });
    expect(titles).toEqual({
      [MANUAL]: { pageTitle: "EOS R5 user manual", customTitle: null },
      [SHEET]: { pageTitle: null, customTitle: "Lab calibration log" },
    });
  });

  it("returns no titles, without throwing, when the read fails", async () => {
    vi.mocked(db.linkPreview.findMany).mockRejectedValue(new Error("down"));

    await expect(
      getLinkTitles({ organizationId: ORG, values: [text(MANUAL)] })
    ).resolves.toEqual({});
    expect(vi.mocked(Logger.error).mock.calls[0][0]).toMatchObject({
      message: "Failed to read link titles",
      label: "Link preview",
    });
  });
});

describe("getLinkTitles: claiming", () => {
  it("claims every link in a text value and queues each claimed row once", async () => {
    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: "lp-sheet" }]);

    await getLinkTitles({
      organizationId: ORG,
      values: [text(SHEET), text(SHEET)],
    });
    await settleClaim();

    expect(claimQuery()?.values).toEqual([ORG, "15 minutes", [SHEET]]);
    expect(scheduler.send).toHaveBeenCalledTimes(1);
    expect(scheduler.send).toHaveBeenCalledWith(
      "link-preview-queue",
      { previewId: "lp-sheet", organizationId: ORG },
      { singletonKey: "lp-sheet", retryLimit: 0 }
    );
  });

  it("claims through an upsert that moves the lease only on rows that are due", async () => {
    await getLinkTitles({ organizationId: ORG, values: [text(SHEET)] });

    const sql = claimQuery()?.strings.join("?").replace(/\s+/g, " ");
    expect(sql).toContain(
      'INSERT INTO "LinkPreview" ("id", "organizationId", "url", "nextFetchAt", "updatedAt")'
    );
    expect(sql).toContain('ON CONFLICT ("organizationId", "url") DO UPDATE');
    expect(sql).toContain(
      'WHERE "LinkPreview"."nextFetchAt" IS NOT NULL AND "LinkPreview"."nextFetchAt" <= now()'
    );
    expect(sql).toContain('RETURNING "id"');
  });

  it("claims a link with no row or a due row, not one scheduled later or finished", async () => {
    const due = "https://www.example.com/due";
    const later = "https://www.example.com/later";
    const finished = "https://www.example.com/finished";
    const fresh = "https://www.example.com/fresh";
    vi.mocked(db.linkPreview.findMany).mockResolvedValue([
      row(due, { nextFetchAt: new Date(Date.now() - 60_000) }),
      row(later, { nextFetchAt: new Date(Date.now() + 60 * 60_000) }),
      row(finished, { pageTitle: "Done", nextFetchAt: null }),
    ] as never);

    await getLinkTitles({
      organizationId: ORG,
      values: [due, later, finished, fresh].map((url) => text(url)),
    });

    expect(claimQuery()?.values[2]).toEqual([due, fresh]);
  });

  it("sends no claim when nothing is due", async () => {
    vi.mocked(db.linkPreview.findMany).mockResolvedValue([
      row(SHEET, { nextFetchAt: new Date(Date.now() + 60 * 60_000) }),
    ] as never);

    await getLinkTitles({ organizationId: ORG, values: [text(SHEET)] });

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(scheduler.send).not.toHaveBeenCalled();
  });

  it("claims at most 20 links per read", async () => {
    const urls = Array.from(
      { length: 25 },
      (_, i) => `https://www.example.com/manual-${i}`
    );

    await getLinkTitles({
      organizationId: ORG,
      values: urls.map((url) => text(url)),
    });

    expect(claimQuery()?.values[2]).toEqual(urls.slice(0, 20));
  });

  it("leaves out a link whose key is longer than a row can store", async () => {
    // 1000 characters as typed, about 6000 once percent-encoded in the key.
    const long = `https://www.example.com/${"\u00e9".repeat(1000)}`;

    await getLinkTitles({
      organizationId: ORG,
      values: [text(long), text(SHEET)],
    });

    expect(db.linkPreview.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG, url: { in: [SHEET] } },
      })
    );
    expect(claimQuery()?.values[2]).toEqual([SHEET]);
  });

  it("returns the titles without waiting for the claim", async () => {
    vi.mocked(db.linkPreview.findMany).mockResolvedValue([
      row(MANUAL, { pageTitle: "EOS R5 user manual" }),
    ] as never);
    // why: a claim that never answers stands in for a slow insert and queue.
    vi.mocked(db.$queryRaw).mockReturnValue(new Promise(() => {}) as never);

    const titles = getLinkTitles({
      organizationId: ORG,
      values: [text(MANUAL), text(SHEET)],
    });
    const first = await Promise.race([
      titles,
      settleClaim().then(() => "still waiting on the claim"),
    ]);

    expect(first).toEqual({
      [MANUAL]: { pageTitle: "EOS R5 user manual", customTitle: null },
    });
    expect(claimQuery()?.values[2]).toEqual([SHEET]);
  });

  it("still returns titles when queueing or claiming fails", async () => {
    vi.mocked(db.linkPreview.findMany).mockResolvedValue([
      row(MANUAL, { pageTitle: "EOS R5 user manual" }),
    ] as never);
    const values = [text(MANUAL), text(SHEET)];
    const expected = {
      [MANUAL]: { pageTitle: "EOS R5 user manual", customTitle: null },
    };

    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: "lp-sheet" }]);
    vi.mocked(scheduler.send).mockRejectedValue(new Error("queue down"));
    await expect(
      getLinkTitles({ organizationId: ORG, values })
    ).resolves.toEqual(expected);
    await settleClaim();

    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("db down"));
    await expect(
      getLinkTitles({ organizationId: ORG, values })
    ).resolves.toEqual(expected);
    await settleClaim();

    expect(
      vi
        .mocked(Logger.error)
        .mock.calls.map(([error]) => (error as Error).message)
    ).toEqual([
      "Failed to queue a link title fetch",
      "Failed to claim links for a title fetch",
    ]);
  });
});

describe("runLinkPreviewJob", () => {
  const NOW = new Date("2026-10-29T12:00:00.000Z");

  beforeEach(() => {
    // why: fetchedAt and nextFetchAt are computed from the current time; only
    // Date is faked so the fetch timeout keeps working.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.mocked(db.linkPreview.updateMany).mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** What the job wrote to the row. */
  function written() {
    return vi.mocked(db.linkPreview.updateMany).mock.calls[0]?.[0];
  }

  it("records the page title and reads it again in 30 days", async () => {
    let userAgent: string | null = null;
    // why: MSW answers in place of the maker's site.
    server.use(
      http.get(MANUAL, ({ request }) => {
        userAgent = request.headers.get("user-agent");
        return new HttpResponse(
          "<html><head><title>EOS R5 user manual</title></head><body>",
          { headers: { "content-type": "text/html; charset=utf-8" } }
        );
      })
    );
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue({
      url: MANUAL,
      attempts: 0,
      pageTitle: null,
    } as never);

    await runLinkPreviewJob({ previewId: "lp-1", organizationId: ORG });

    expect(userAgent).toBe(
      "Mozilla/5.0 (compatible; ShelfLinkPreview/1.0; +https://www.shelf.nu)"
    );
    expect(written()).toEqual({
      where: { id: "lp-1", organizationId: ORG },
      data: {
        outcome: "TITLE",
        pageTitle: "EOS R5 user manual",
        attempts: 0,
        fetchedAt: NOW,
        nextFetchAt: new Date("2026-11-28T12:00:00.000Z"),
      },
    });
  });

  it("keeps a known title through a server error and retries in an hour", async () => {
    // why: MSW answers in place of the maker's site.
    server.use(
      http.get(MANUAL, () => new HttpResponse("busy", { status: 503 }))
    );
    // A row that had a title (attempts start over at a title) is read again.
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue({
      url: MANUAL,
      attempts: 0,
      pageTitle: "EOS R5 user manual",
    } as never);

    await runLinkPreviewJob({ previewId: "lp-1", organizationId: ORG });

    // No pageTitle in the write: the stored title stays.
    expect(written()?.data).toEqual({
      outcome: "UNREACHABLE",
      attempts: 1,
      fetchedAt: NOW,
      nextFetchAt: new Date("2026-10-29T13:00:00.000Z"),
    });
  });

  it("keeps a known title when the page answers gone, and retries in an hour", async () => {
    // why: MSW answers in place of the maker's site.
    server.use(
      http.get(MANUAL, () => new HttpResponse("gone", { status: 404 }))
    );
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue({
      url: MANUAL,
      attempts: 0,
      pageTitle: "EOS R5 user manual",
    } as never);

    await runLinkPreviewJob({ previewId: "lp-1", organizationId: ORG });

    // No pageTitle in the write: the stored title stays.
    expect(written()?.data).toEqual({
      outcome: "UNREACHABLE",
      attempts: 1,
      fetchedAt: NOW,
      nextFetchAt: new Date("2026-10-29T13:00:00.000Z"),
    });
  });

  it("gives up for good on a page that is gone and never had a title", async () => {
    // why: MSW answers in place of the maker's site.
    server.use(
      http.get(MANUAL, () => new HttpResponse("gone", { status: 404 }))
    );
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue({
      url: MANUAL,
      attempts: 0,
      pageTitle: null,
    } as never);

    await runLinkPreviewJob({ previewId: "lp-1", organizationId: ORG });

    expect(written()?.data).toEqual({
      outcome: "UNREACHABLE",
      pageTitle: null,
      attempts: 1,
      fetchedAt: NOW,
      nextFetchAt: null,
    });
  });

  it("schedules the last retry a week out after a third server error", async () => {
    // why: MSW answers in place of the maker's site.
    server.use(
      http.get(MANUAL, () => new HttpResponse("busy", { status: 503 }))
    );
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue({
      url: MANUAL,
      attempts: 2,
      pageTitle: null,
    } as never);

    await runLinkPreviewJob({ previewId: "lp-1", organizationId: ORG });

    expect(written()?.data).toEqual({
      outcome: "UNREACHABLE",
      attempts: 3,
      fetchedAt: NOW,
      nextFetchAt: new Date("2026-11-05T12:00:00.000Z"),
    });
  });

  it("retries in an hour when the network fails", async () => {
    // why: MSW stands in for a connection that fails.
    server.use(http.get(MANUAL, () => HttpResponse.error()));
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue({
      url: MANUAL,
      attempts: 0,
      pageTitle: null,
    } as never);

    await runLinkPreviewJob({ previewId: "lp-1", organizationId: ORG });

    expect(written()?.data).toMatchObject({
      outcome: "UNREACHABLE",
      nextFetchAt: new Date("2026-10-29T13:00:00.000Z"),
    });
  });

  it("gives up for good on a private address, without a request", async () => {
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue({
      url: "http://10.0.0.5/manual.pdf",
      attempts: 0,
      pageTitle: null,
    } as never);

    await runLinkPreviewJob({ previewId: "lp-1", organizationId: ORG });

    expect(written()?.data).toEqual({
      outcome: "UNREACHABLE",
      pageTitle: null,
      attempts: 1,
      fetchedAt: NOW,
      nextFetchAt: null,
    });
  });

  it("gives up for good on a stored link with a password, without a request", async () => {
    // A key stored before links with a user name or password were refused.
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue({
      url: "https://user:secret@files.example.com/manual.pdf",
      attempts: 0,
      pageTitle: null,
    } as never);

    await runLinkPreviewJob({ previewId: "lp-1", organizationId: ORG });

    expect(written()?.data).toEqual({
      outcome: "UNREACHABLE",
      pageTitle: null,
      attempts: 1,
      fetchedAt: NOW,
      nextFetchAt: null,
    });
  });

  it("writes nothing when the row is gone", async () => {
    vi.mocked(db.linkPreview.findFirst).mockResolvedValue(null);

    await runLinkPreviewJob({ previewId: "lp-gone", organizationId: ORG });

    expect(db.linkPreview.updateMany).not.toHaveBeenCalled();
  });
});

describe("getLinkTitles: texts and notes", () => {
  it("reads and claims every web link in a plain text (a description), once each", async () => {
    vi.mocked(db.linkPreview.findMany).mockResolvedValue([
      row(MANUAL, { pageTitle: "EOS R5 user manual" }),
    ] as never);
    vi.mocked(db.$queryRaw).mockResolvedValue([{ id: "lp-sheet" }]);

    const titles = await getLinkTitles({
      organizationId: ORG,
      texts: [
        `Manual: ${MANUAL} (rev B)`,
        `Sheet ${SHEET}, and the manual again ${MANUAL}.`,
        "No link here",
      ],
    });
    await settleClaim();

    expect(titles).toEqual({
      [MANUAL]: { pageTitle: "EOS R5 user manual", customTitle: null },
    });
    expect(vi.mocked(db.linkPreview.findMany).mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, url: { in: [MANUAL, SHEET] } },
    });
    expect(claimQuery()?.values).toEqual([ORG, "15 minutes", [SHEET]]);
  });

  it("reads nothing for texts without a web link", async () => {
    const titles = await getLinkTitles({
      organizationId: ORG,
      texts: ["Calibrated today", "see binder 3", "javascript:alert(1)"],
    });

    expect(titles).toEqual({});
    expect(db.linkPreview.findMany).not.toHaveBeenCalled();
  });

  it("claims only the links a comment shows as chips, not Markdown links, code or tag attributes", async () => {
    await getLinkTitles({
      organizationId: ORG,
      notes: [
        {
          type: "COMMENT",
          content: `See [the manual](${MANUAL}), \`${SHOP}\`, {% link to="${SHOP}/tag" text="x" /%} and ${SHEET}`,
        },
      ],
    });
    await settleClaim();

    expect(vi.mocked(db.linkPreview.findMany).mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, url: { in: [SHEET] } },
    });
    expect(claimQuery()?.values).toEqual([ORG, "15 minutes", [SHEET]]);
  });

  it("claims a system note's links only from values its writer marked as chips", async () => {
    await getLinkTitles({
      organizationId: ORG,
      notes: [
        {
          type: "UPDATE",
          content: `Sam set {% name text="Manual" /%} to {% name text="${MANUAL}" chips=true /%}.`,
        },
        {
          type: "UPDATE",
          content: `Sam changed booking name from **Shoot** to **${SHOP}**, then {% name text="${SHEET}" /%}.`,
        },
      ],
    });
    await settleClaim();

    expect(claimQuery()?.values).toEqual([ORG, "15 minutes", [MANUAL]]);
  });

  it("claims at most 10 links of one text, and still reads the rest", async () => {
    const urls = Array.from(
      { length: 12 },
      (_, index) => `https://www.example-docs.com/page-${index}`
    );

    await getLinkTitles({
      organizationId: ORG,
      notes: [{ type: "COMMENT", content: urls.join(" ") }],
    });
    await settleClaim();

    expect(vi.mocked(db.linkPreview.findMany).mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, url: { in: urls } },
    });
    expect(claimQuery()?.values).toEqual([
      ORG,
      "15 minutes",
      urls.slice(0, 10),
    ]);
  });

  it("reads and claims in the workspace it was given", async () => {
    await getLinkTitles({
      organizationId: "org-2",
      notes: [{ type: "COMMENT", content: `Manual ${MANUAL}` }],
    });
    await settleClaim();

    expect(vi.mocked(db.linkPreview.findMany).mock.calls[0][0]).toMatchObject({
      where: { organizationId: "org-2" },
    });
    expect(claimQuery()?.values).toEqual(["org-2", "15 minutes", [MANUAL]]);
  });
});
