/**
 * How assignee selections travel from the picker to the server.
 *
 * why this test exists: the picker submits JSON blobs, older forms submit a
 * single bare field, and the server must turn both into one deduplicated list
 * of user ids without ever letting an empty id through. A regression here
 * either drops a chosen assignee silently or writes a dangling assignment.
 *
 * @see {@link file://./assignee-form.ts}
 */
import { describe, expect, it } from "vitest";

import { parseAssigneeUserId, resolveAssigneeUserIds } from "./assignee-form";

const blob = (userId: string, id = `tm-${userId}`) =>
  JSON.stringify({ id, name: `Member ${userId}`, userId });

describe("parseAssigneeUserId", () => {
  it("reads the user id out of the picker's JSON blob", () => {
    expect(parseAssigneeUserId(blob("user-2"))).toBe("user-2");
  });

  it("accepts a bare user id (pre-multi-assign clients)", () => {
    expect(parseAssigneeUserId("user-9")).toBe("user-9");
  });

  it("drops a blob whose user id is empty (member list not loaded yet)", () => {
    expect(
      parseAssigneeUserId(JSON.stringify({ id: "tm-1", name: "X", userId: "" }))
    ).toBeUndefined();
    expect(
      parseAssigneeUserId(JSON.stringify({ id: "tm-1", name: "X" }))
    ).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(parseAssigneeUserId("")).toBeUndefined();
    expect(parseAssigneeUserId(null)).toBeUndefined();
    expect(parseAssigneeUserId(undefined)).toBeUndefined();
  });
});

describe("resolveAssigneeUserIds", () => {
  it("collects every selected member in submission order", () => {
    expect(
      resolveAssigneeUserIds([blob("user-2"), blob("user-3"), blob("user-4")])
    ).toEqual(["user-2", "user-3", "user-4"]);
  });

  it("deduplicates a member submitted twice", () => {
    expect(
      resolveAssigneeUserIds([blob("user-2"), blob("user-2", "tm-other")])
    ).toEqual(["user-2"]);
  });

  it("merges the legacy singular field with the array", () => {
    expect(resolveAssigneeUserIds([blob("user-2")], blob("user-3"))).toEqual([
      "user-2",
      "user-3",
    ]);
    expect(resolveAssigneeUserIds(undefined, blob("user-3"))).toEqual([
      "user-3",
    ]);
  });

  it("returns an empty list when nothing usable was submitted", () => {
    expect(resolveAssigneeUserIds(undefined, undefined)).toEqual([]);
    expect(resolveAssigneeUserIds([], "")).toEqual([]);
    expect(
      resolveAssigneeUserIds([JSON.stringify({ id: "tm-1", userId: "" })])
    ).toEqual([]);
  });
});
