/**
 * Paging of the mobile audits list.
 *
 * The companion asks for 20 audits at a time, appends each page, and keeps
 * going until it passes `totalPages`. These tests replay that loop against the
 * route for the default "PENDING,ACTIVE" filter and check that every open
 * audit arrives exactly once, whatever the number of statuses asked for.
 *
 * @see {@link file://../../../app/routes/api+/mobile+/audits.ts}
 * @see {@link file://../../../../companion/app/(tabs)/audits/index.tsx}
 */
import { AuditStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment node

type FakeAudit = {
  id: string;
  name: string;
  status: AuditStatus;
  createdAt: Date;
};

/** The workspace the fake service reads from; reset per test. */
const store = vi.hoisted(() => ({ audits: [] as unknown[] }));

// why: token auth needs Supabase; these tests are about paging, so the caller
// is an admin who sees every audit in one workspace
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(async () => ({ user: { id: "caller" } })),
  requireOrganizationAccess: vi.fn(async () => "org-1"),
  requireMobilePermission: vi.fn(async () => undefined),
  getMobileUserContext: vi.fn(async () => ({
    access: { audits: { seeAll: true } },
    canUseAudits: true,
  })),
}));

// why: the list query is database work. This stand-in honours the same
// contract as the real service (status filter, then skip/take over a stable
// order, plus a count of the filtered rows), so the test exercises how the
// route drives paging rather than Prisma.
vi.mock("~/modules/audit/service.server", () => ({
  getAuditsForOrganization: vi.fn(
    async (args: {
      page?: number;
      perPage?: number;
      status?: AuditStatus | AuditStatus[] | null;
    }) => {
      const all = store.audits as FakeAudit[];
      const statuses = args.status == null ? [] : [args.status].flat();
      const wanted =
        statuses.length === 0
          ? all.filter((a) => a.status !== AuditStatus.ARCHIVED)
          : all.filter((a) => statuses.includes(a.status));
      const page = args.page ?? 1;
      const perPage = args.perPage ?? 8;
      const slice = wanted.slice((page - 1) * perPage, page * perPage);
      return {
        audits: slice.map((a) => ({
          ...a,
          description: null,
          expectedAssetCount: 0,
          foundAssetCount: 0,
          missingAssetCount: 0,
          unexpectedAssetCount: 0,
          dueDate: null,
          startedAt: null,
          completedAt: null,
          createdBy: null,
          _count: { assignments: 0 },
          assignments: [],
        })),
        totalAudits: wanted.length,
      };
    }
  ),
}));

import { loader } from "~/routes/api+/mobile+/audits";

type ListPayload = {
  audits: { id: string; status: AuditStatus }[];
  totalPages: number;
  totalCount: number;
};

/** Calls the route the way the companion does and returns its JSON payload. */
async function fetchPage(status: string, page: number): Promise<ListPayload> {
  const url = `http://localhost/api/mobile/audits?orgId=org-1&status=${status}&page=${page}&perPage=20`;
  const res = (await loader({
    request: new Request(url, { headers: { Authorization: "Bearer t" } }),
    params: {},
    context: {},
  } as never)) as { data: ListPayload };
  return res.data;
}

/**
 * The companion's list loop: page 1, then the next page while the page number
 * does not pass `totalPages`, appending every page it receives.
 */
async function loadLikeTheCompanion(status: string) {
  const first = await fetchPage(status, 1);
  const rows = [...first.audits];
  for (let next = 2; next <= first.totalPages; next++) {
    rows.push(...(await fetchPage(status, next)).audits);
  }
  return { rows, first };
}

/** Seeds `open` open audits plus finished and archived ones around them. */
function seed(open: number) {
  const audits: FakeAudit[] = [];
  for (let i = 0; i < open; i++) {
    audits.push({
      id: `open-${i}`,
      name: `ZZ Open ${i}`,
      status: i % 3 === 0 ? AuditStatus.ACTIVE : AuditStatus.PENDING,
      createdAt: new Date(2026, 0, 1, 0, i),
    });
  }
  for (let i = 0; i < 30; i++) {
    audits.push({
      id: `done-${i}`,
      name: `ZZ Done ${i}`,
      status: i % 2 ? AuditStatus.COMPLETED : AuditStatus.ARCHIVED,
      createdAt: new Date(2025, 0, 1, 0, i),
    });
  }
  store.audits = audits;
}

describe("mobile audits list paging", () => {
  beforeEach(() => {
    store.audits = [];
  });

  it.each([21, 125])(
    "returns each of %i open audits exactly once across pages",
    async (open) => {
      seed(open);

      const { rows, first } = await loadLikeTheCompanion("PENDING,ACTIVE");
      const ids = rows.map((r) => r.id);

      expect(first.totalCount).toBe(open);
      expect(first.totalPages).toBe(Math.ceil(open / 20));
      expect(first.audits).toHaveLength(20);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(open);
      expect(
        rows.every(
          (r) =>
            r.status === AuditStatus.PENDING || r.status === AuditStatus.ACTIVE
        )
      ).toBe(true);
    }
  );

  it("pages a single status the same way", async () => {
    seed(0);

    const { rows, first } = await loadLikeTheCompanion("COMPLETED");

    expect(first.totalCount).toBe(15);
    expect(new Set(rows.map((r) => r.id)).size).toBe(15);
  });

  it("honours every listed status, archived included", async () => {
    seed(21);

    const { rows } = await loadLikeTheCompanion(
      "PENDING,ACTIVE,COMPLETED,CANCELLED,ARCHIVED"
    );

    expect(rows).toHaveLength(21 + 30);
    expect(rows.some((r) => r.status === AuditStatus.ARCHIVED)).toBe(true);
  });

  it("treats no status as everything except archived", async () => {
    seed(21);

    const { rows } = await loadLikeTheCompanion("");

    expect(rows).toHaveLength(21 + 15);
    expect(rows.some((r) => r.status === AuditStatus.ARCHIVED)).toBe(false);
  });
});
