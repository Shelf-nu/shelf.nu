// @vitest-environment node
/**
 * Contract tests for `StartAuditSchema` — the request validation for
 * `POST /api/audits/start`.
 *
 * The `.refine` is load-bearing: it decides which "create audit" entry points
 * are accepted (asset-index bulk, single-context detail page, and the locations
 * multi-select). These tests lock that contract so the new location branch and
 * the legacy forms can't silently regress.
 *
 * @see {@link file://./audits.start.ts}
 */
import { StartAuditSchema } from "./audits.start";

// why: importing the route module transitively pulls in ~/database/db.server
// (Prisma client init) and the audit service; the schema under test never
// touches them, so hollow mocks keep this suite DB-free and side-effect-free.
vitest.mock("~/database/db.server", () => ({ db: {} }));
vitest.mock("~/modules/audit/service.server", () => ({
  createAuditSession: vitest.fn(),
  scheduleNextAuditJob: vitest.fn(),
}));

const base = { name: "Quarterly audit" };

describe("StartAuditSchema", () => {
  it("accepts a location multi-selection (contextType=location + locationIds)", () => {
    const result = StartAuditSchema.safeParse({
      ...base,
      contextType: "location",
      locationIds: ["l1", "l2"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts the select-all sentinel inside locationIds", () => {
    const result = StartAuditSchema.safeParse({
      ...base,
      contextType: "location",
      locationIds: ["all-selected"],
    });
    expect(result.success).toBe(true);
  });

  it("still accepts the legacy single-context form (contextType + contextId)", () => {
    const result = StartAuditSchema.safeParse({
      ...base,
      contextType: "location",
      contextId: "l1",
    });
    expect(result.success).toBe(true);
  });

  it("still accepts the asset-index bulk form (direct assetIds)", () => {
    const result = StartAuditSchema.safeParse({ ...base, assetIds: ["a1"] });
    expect(result.success).toBe(true);
  });

  it("rejects contextType=location with neither contextId nor locationIds", () => {
    const result = StartAuditSchema.safeParse({
      ...base,
      contextType: "location",
    });
    expect(result.success).toBe(false);
  });

  it("rejects locationIds supplied without contextType=location", () => {
    // why: locationIds only counts when contextType is explicitly "location",
    // so a stray array without the discriminator must not pass validation.
    const result = StartAuditSchema.safeParse({ ...base, locationIds: ["l1"] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty selection (no assetIds, no context, no locationIds)", () => {
    const result = StartAuditSchema.safeParse({ ...base });
    expect(result.success).toBe(false);
  });

  it("requires a non-empty audit name", () => {
    const result = StartAuditSchema.safeParse({
      name: "",
      contextType: "location",
      locationIds: ["l1"],
    });
    expect(result.success).toBe(false);
  });
});
