/**
 * Workspace plan helpers: tier-to-label mapping, table ordering and the
 * "paid access through someone else's workspace" check.
 *
 * @see {@link file://./workspace-plans.ts}
 */

import { describe, expect, it } from "vitest";

import type { WorkspacePlanRow } from "./workspace-plans";
import {
  findPaidWorkspaceThroughOthers,
  resolveWorkspacePlan,
  sortWorkspacePlanRows,
} from "./workspace-plans";

/** Builds a row with sensible defaults; override only what a case is about. */
function row(overrides: Partial<WorkspacePlanRow> = {}): WorkspacePlanRow {
  return {
    organizationId: "org-1",
    name: "Workspace",
    type: "TEAM",
    imageId: null,
    isCurrent: false,
    roleLabel: "Administrator",
    plan: { tierId: "free", label: "Free" },
    paidBy: { isYou: true, name: "" },
    ...overrides,
  };
}

describe("resolveWorkspacePlan", () => {
  it.each([
    ["free", "Free"],
    ["tier_1", "Plus"],
    ["tier_2", "Team"],
  ] as const)("labels %s as %s", (tierId, label) => {
    expect(resolveWorkspacePlan({ tierId })).toEqual({ tierId, label });
  });

  it("labels an enterprise custom tier as Enterprise", () => {
    expect(
      resolveWorkspacePlan({ tierId: "custom", isEnterprise: true })
    ).toEqual({ tierId: "custom", label: "Enterprise" });
  });

  it.each([false, null, undefined])(
    "labels a custom tier as Custom when isEnterprise is %s",
    (isEnterprise) => {
      expect(resolveWorkspacePlan({ tierId: "custom", isEnterprise })).toEqual({
        tierId: "custom",
        label: "Custom",
      });
    }
  );

  it("ignores isEnterprise for non-custom tiers", () => {
    expect(
      resolveWorkspacePlan({ tierId: "tier_2", isEnterprise: true })
    ).toEqual({ tierId: "tier_2", label: "Team" });
  });
});

describe("sortWorkspacePlanRows", () => {
  it("puts the current workspace first, then Team before Personal, then by name", () => {
    const rows = [
      row({ organizationId: "p", name: "Alpha", type: "PERSONAL" }),
      row({ organizationId: "t-z", name: "Zeta", type: "TEAM" }),
      row({ organizationId: "t-b", name: "Beta", type: "TEAM" }),
      row({
        organizationId: "current",
        name: "Omega",
        type: "PERSONAL",
        isCurrent: true,
      }),
    ];

    expect(sortWorkspacePlanRows(rows).map((r) => r.organizationId)).toEqual([
      "current",
      "t-b",
      "t-z",
      "p",
    ]);
  });

  it("returns a new array and leaves the input order untouched", () => {
    const rows = [
      row({ organizationId: "b", name: "B" }),
      row({ organizationId: "a", name: "A" }),
    ];

    const sorted = sortWorkspacePlanRows(rows);

    expect(sorted).not.toBe(rows);
    expect(rows.map((r) => r.organizationId)).toEqual(["b", "a"]);
    expect(sorted.map((r) => r.organizationId)).toEqual(["a", "b"]);
  });
});

describe("findPaidWorkspaceThroughOthers", () => {
  it("returns the first workspace another user pays for on a paid tier", () => {
    const paidByOther = row({
      organizationId: "team",
      plan: { tierId: "tier_2", label: "Team" },
      paidBy: { isYou: false, name: "Sam Owner" },
    });

    expect(findPaidWorkspaceThroughOthers([row(), paidByOther])).toBe(
      paidByOther
    );
  });

  it("is null when the only paid workspace is the user's own", () => {
    expect(
      findPaidWorkspaceThroughOthers([
        row({ plan: { tierId: "tier_2", label: "Team" } }),
      ])
    ).toBeNull();
  });

  it("is null when workspaces owned by others are on the free tier", () => {
    expect(
      findPaidWorkspaceThroughOthers([
        row({ paidBy: { isYou: false, name: "Sam Owner" } }),
      ])
    ).toBeNull();
  });

  it("is null for no rows", () => {
    expect(findPaidWorkspaceThroughOthers([])).toBeNull();
  });
});
