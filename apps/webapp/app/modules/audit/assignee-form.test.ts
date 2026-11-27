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

import {
  parseAssigneeUserId,
  resolveAssigneeUserIds,
  toAssigneeDefaults,
} from "./assignee-form";

const blob = (userId: string, id = `tm-${userId}`) =>
  JSON.stringify({ id, name: `Member ${userId}`, userId });

describe("parseAssigneeUserId", () => {
  it("reads the user id out of the picker's JSON blob", () => {
    expect(parseAssigneeUserId(blob("user-2"))).toBe("user-2");
  });

  it("accepts a bare user id (the singular field from older clients)", () => {
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

  it("merges the singular field with the array", () => {
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

describe("toAssigneeDefaults", () => {
  const teamMembers = [
    { id: "tm-1", name: "Ana Lead", userId: "user-1" },
    { id: "tm-2", name: "Ben Scan", userId: "user-2" },
    // A non-registered member: no user account, so never an assignee.
    { id: "tm-nrm", name: "Loan Desk", userId: null },
  ];

  it("maps each assignment to its team member, in assignment order", () => {
    expect(
      toAssigneeDefaults(
        [{ userId: "user-2" }, { userId: "user-1" }],
        teamMembers
      )
    ).toEqual([
      { id: "tm-2", userId: "user-2", name: "Ben Scan" },
      { id: "tm-1", userId: "user-1", name: "Ana Lead" },
    ]);
  });

  it("leaves out an assignee who has no team member in the list", () => {
    expect(
      toAssigneeDefaults(
        [{ userId: "user-1" }, { userId: "user-gone" }, { userId: "user-2" }],
        teamMembers
      ).map((member) => member.userId)
    ).toEqual(["user-1", "user-2"]);
  });

  it("returns nothing for an audit with no assignees", () => {
    expect(toAssigneeDefaults([], teamMembers)).toEqual([]);
  });
});
