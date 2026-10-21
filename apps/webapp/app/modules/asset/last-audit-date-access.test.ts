import { describe, expect, it } from "vitest";

import { getQueryFieldType } from "./field-type-mapping";
import {
  canQueryLastAuditDate,
  filterQueryableColumns,
  isLastAuditDateParam,
  resolveLastAuditDateAccess,
  stripHiddenAuditColumns,
} from "./last-audit-date-access";
import { defaultFields } from "../asset-index-settings/helpers";

describe("resolveLastAuditDateAccess", () => {
  it("is hidden without audit visibility", () => {
    expect(
      resolveLastAuditDateAccess({ seeAllAudits: false, auditsUsable: true })
    ).toBe("hidden");
    expect(
      resolveLastAuditDateAccess({ seeAllAudits: false, auditsUsable: false })
    ).toBe("hidden");
  });

  it("is locked when audits are not usable", () => {
    expect(
      resolveLastAuditDateAccess({ seeAllAudits: true, auditsUsable: false })
    ).toBe("locked");
  });

  it("is available when visible and usable", () => {
    expect(
      resolveLastAuditDateAccess({ seeAllAudits: true, auditsUsable: true })
    ).toBe("available");
  });
});

describe("stripHiddenAuditColumns", () => {
  const columns = [{ name: "name" }, { name: "lastAuditDate" }];

  it("removes the column only when hidden", () => {
    expect(stripHiddenAuditColumns(columns, "hidden")).toEqual([
      { name: "name" },
    ]);
    expect(stripHiddenAuditColumns(columns, "locked")).toEqual(columns);
    expect(stripHiddenAuditColumns(columns, "available")).toEqual(columns);
  });
});

describe("canQueryLastAuditDate", () => {
  it("is true only for available", () => {
    expect(canQueryLastAuditDate("available")).toBe(true);
    expect(canQueryLastAuditDate("locked")).toBe(false);
    expect(canQueryLastAuditDate("hidden")).toBe(false);
  });
});

describe("column registration", () => {
  it("registers the column as a visible date field at position 25", () => {
    expect(defaultFields.find((f) => f.name === "lastAuditDate")).toEqual({
      name: "lastAuditDate",
      visible: true,
      position: 25,
    });
    expect(getQueryFieldType("lastAuditDate")).toBe("date");
  });
});

describe("filterQueryableColumns", () => {
  const columns = [{ name: "name" }, { name: "lastAuditDate" }];

  it("keeps the column when it can be queried", () => {
    expect(filterQueryableColumns(columns, "available")).toEqual(columns);
  });

  it.each(["locked", "hidden"] as const)(
    "drops the column when access is %s",
    (access) => {
      expect(filterQueryableColumns(columns, access)).toEqual([
        { name: "name" },
      ]);
    }
  );
});

describe("isLastAuditDateParam", () => {
  it("matches the last audit date filter and sort, nothing else", () => {
    expect(isLastAuditDateParam("lastAuditDate", "isEmpty:")).toBe(true);
    expect(isLastAuditDateParam("sortBy", "lastAuditDate:asc")).toBe(true);
    expect(isLastAuditDateParam("sortBy", "createdAt:desc")).toBe(false);
    expect(isLastAuditDateParam("createdAt", "before:2026-01-01")).toBe(false);
  });
});
