import { describe, expect, it } from "vitest";

import { buildDescriptionChangeNote } from "./helpers.server";

const userLink = "{% user id=\"user-1\" /%}";

describe("buildDescriptionChangeNote", () => {
  it("returns null when description did not change", () => {
    expect(
      buildDescriptionChangeNote({ userLink, previous: "Test", next: "Test" })
    ).toBeNull();
  });

  it("describes adding the first description", () => {
    const result = buildDescriptionChangeNote({
      userLink,
      previous: null,
      next: "New details",
    });

    expect(result).toBe(
      `${userLink} added a description {% description newText="New details" /%}.`
    );
  });

  it("describes removing an existing description", () => {
    const result = buildDescriptionChangeNote({
      userLink,
      previous: "Old details",
      next: "",
    });

    expect(result).toBe(
      `${userLink} removed the description {% description oldText="Old details" /%}.`
    );
  });

  it("renders updates between two descriptions", () => {
    const result = buildDescriptionChangeNote({
      userLink,
      previous: "Old description",
      next: "Updated description",
    });

    expect(result).toBe(
      `${userLink} updated the description {% description oldText="Old description" newText="Updated description" /%}.`
    );
  });
});
