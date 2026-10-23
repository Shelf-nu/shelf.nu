/**
 * Registry invariants for `/api/model-filters`.
 *
 * The registry is the only thing standing between a picker search and a whole
 * database row, so these tests pin the two directions that matter: fields real
 * consumers read must be present, and sensitive ones must be absent.
 *
 * @see {@link file://./model-filters-registry.server.ts}
 */
import { describe, expect, it } from "vitest";

import {
  MODEL_FILTER_REGISTRY,
  getModelFilterConfig,
  isSearchableKey,
  type RegisteredModelName,
} from "./model-filters-registry.server";

/**
 * Fields each model's consumers actually read, gathered by auditing every
 * `renderItem` / `transformItem` / `metadata.*` access in the webapp. Dropping
 * one blanks a picker row at runtime with a green typecheck, so this list is
 * the regression guard.
 */
const AUDITED_FIELDS: Array<[RegisteredModelName, string[]]> = [
  ["tag", ["id", "name", "color"]],
  ["category", ["id", "name", "color"]],
  ["location", ["id", "name", "thumbnailUrl"]],
  ["kit", ["id", "name", "status"]],
  ["assetModel", ["id", "name", "image"]],
  ["booking", ["id", "name", "status", "from", "to"]],
  ["teamMember", ["id", "name", "userId"]],
];

describe("MODEL_FILTER_REGISTRY", () => {
  it.each(AUDITED_FIELDS)(
    "%s selects every field its consumers read",
    (model, fields) => {
      const select = getModelFilterConfig(model).select as Record<
        string,
        unknown
      >;

      for (const field of fields) {
        expect(select[field]).toBe(true);
      }
    }
  );

  /**
   * The email is RENDERED, not incidental: 21 call sites label picker rows with
   * `resolveTeamMemberName(item, true)` — the positional `includeEmail` — so a
   * row reads "Ada Lovelace (ada@example.com)".
   *
   * Omitting it here does not protect anything, because every seeding loader
   * returns the full user for the very same rows; it only makes the label lose
   * its email the moment the user types. What keeps a caller from seeing
   * colleagues at all is `resolveCustodianPickerScope`, which decides which
   * rows come back — see custodian-scope.server.test.ts.
   */
  it("returns the team member's email, which the pickers render", () => {
    const select = getModelFilterConfig("teamMember").select as {
      user: { select: Record<string, unknown> };
    };

    expect(select.user.select.email).toBe(true);
  });

  it("exposes no team-member field beyond what a picker label needs", () => {
    const select = getModelFilterConfig("teamMember").select as {
      user: { select: Record<string, unknown> };
    } & Record<string, unknown>;

    // Guards against the select quietly widening to the whole row again.
    expect(Object.keys(select).sort()).toEqual([
      "id",
      "name",
      "user",
      "userId",
    ]);
    expect(Object.keys(select.user.select).sort()).toEqual([
      "displayName",
      "email",
      "firstName",
      "id",
      "lastName",
    ]);
  });

  it("does not register `asset` — it has no `name` column and no call site", () => {
    expect(MODEL_FILTER_REGISTRY).not.toHaveProperty("asset");
  });

  it("accepts only `name` as a search key today", () => {
    expect(isSearchableKey("booking", "name")).toBe(true);
    expect(isSearchableKey("booking", "description")).toBe(false);
    expect(isSearchableKey("teamMember", "id")).toBe(false);
  });
});
