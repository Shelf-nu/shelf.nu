import {
  wrapDateForNote,
  wrapKitsForNote,
  wrapAssetsWithDataForNote,
  wrapKitsWithDataForNote,
  wrapUserLinkForNote,
  wrapLinkForNote,
  wrapCustodianForNote,
  wrapDescriptionForNote,
  extractDateTags,
  extractAssetsListTags,
  DATE_TAG_REGEX,
  ASSETS_LIST_TAG_REGEX,
} from "./markdoc-wrappers";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

describe("markdoc-wrappers", () => {
  describe("wrapDateForNote", () => {
    it("should wrap date with Markdoc date tag", () => {
      const date = new Date("2023-12-25T10:30:00.000Z");
      const result = wrapDateForNote(date);

      expect(result).toBe('{% date value="2023-12-25T10:30:00.000Z" /%}');
    });

    it("should handle includeTime parameter", () => {
      const date = new Date("2023-12-25T10:30:00.000Z");
      const result = wrapDateForNote(date, false);

      expect(result).toBe(
        '{% date value="2023-12-25T10:30:00.000Z" includeTime=false /%}'
      );
    });

    it("should omit includeTime when true (default behavior)", () => {
      const date = new Date("2023-12-25T10:30:00.000Z");
      const result = wrapDateForNote(date, true);

      expect(result).toBe('{% date value="2023-12-25T10:30:00.000Z" /%}');
    });
  });

  describe("wrapKitsForNote", () => {
    it("should wrap single kit ID", () => {
      const kitIds = ["kit-1"];
      const result = wrapKitsForNote(kitIds, "added");

      expect(result).toBe(
        '{% kits_list count=1 ids="kit-1" action="added" /%}'
      );
    });

    it("should wrap multiple kit IDs", () => {
      const kitIds = ["kit-1", "kit-2"];
      const result = wrapKitsForNote(kitIds, "removed");

      expect(result).toBe(
        '{% kits_list count=2 ids="kit-1,kit-2" action="removed" /%}'
      );
    });

    it("should default action to 'added'", () => {
      const kitIds = ["kit-1"];
      const result = wrapKitsForNote(kitIds);

      expect(result).toBe(
        '{% kits_list count=1 ids="kit-1" action="added" /%}'
      );
    });
  });

  describe("wrapAssetsWithDataForNote", () => {
    it("should handle single asset with direct link", () => {
      const asset = { id: "asset-1", title: "Laptop" };
      const result = wrapAssetsWithDataForNote(asset, "added");

      expect(result).toBe('{% link to="/assets/asset-1" text="Laptop" /%}');
    });

    it("should handle multiple assets with tag", () => {
      const assets = [
        { id: "asset-1", title: "Laptop" },
        { id: "asset-2", title: "Mouse" },
      ];
      const result = wrapAssetsWithDataForNote(assets, "removed");

      expect(result).toBe(
        '{% assets_list count=2 ids="asset-1,asset-2" action="removed" /%}'
      );
    });

    it("should handle array with single asset", () => {
      const assets = [{ id: "asset-1", title: "Laptop" }];
      const result = wrapAssetsWithDataForNote(assets, "added");

      expect(result).toBe('{% link to="/assets/asset-1" text="Laptop" /%}');
    });

    it("should handle empty array", () => {
      const assets: Array<{ id: string; title: string }> = [];
      const result = wrapAssetsWithDataForNote(assets, "added");

      expect(result).toBe('{% assets_list count=0 ids="" action="added" /%}');
    });
  });

  describe("wrapKitsWithDataForNote", () => {
    it("should handle single kit with direct link", () => {
      const kit = { id: "kit-1", name: "Photography Kit" };
      const result = wrapKitsWithDataForNote(kit, "added");

      expect(result).toBe(
        '{% link to="/kits/kit-1" text="Photography Kit" /%}'
      );
    });

    it("should handle multiple kits with tag", () => {
      const kits = [
        { id: "kit-1", name: "Photography Kit" },
        { id: "kit-2", name: "Video Kit" },
      ];
      const result = wrapKitsWithDataForNote(kits, "removed");

      expect(result).toBe(
        '{% kits_list count=2 ids="kit-1,kit-2" action="removed" /%}'
      );
    });

    it("should handle array with single kit", () => {
      const kits = [{ id: "kit-1", name: "Photography Kit" }];
      const result = wrapKitsWithDataForNote(kits, "added");

      expect(result).toBe(
        '{% link to="/kits/kit-1" text="Photography Kit" /%}'
      );
    });
  });

  describe("extractDateTags", () => {
    it("should extract dates from date tags", () => {
      const content =
        'Booking extended from {% date value="2023-12-25T10:30:00.000Z" /%} to {% date value="2023-12-26T15:45:00.000Z" includeTime=false /%}';
      const result = extractDateTags(content);

      expect(result).toEqual([
        "2023-12-25T10:30:00.000Z",
        "2023-12-26T15:45:00.000Z",
      ]);
    });

    it("should return empty array if no date tags found", () => {
      const content = "No date tags in this content";
      const result = extractDateTags(content);

      expect(result).toEqual([]);
    });

    it("should handle mixed content with other tags", () => {
      const content =
        'Added {% assets_list count=2 ids="asset-1,asset-2" action="added" /%} on {% date value="2023-12-25T10:30:00.000Z" /%}';
      const result = extractDateTags(content);

      expect(result).toEqual(["2023-12-25T10:30:00.000Z"]);
    });
  });

  describe("extractAssetsListTags", () => {
    it("should extract asset list information from tags", () => {
      const content =
        'Added {% assets_list count=3 ids="asset-1,asset-2,asset-3" action="added" /%} and removed {% assets_list count=1 ids="asset-4" action="removed" /%}';
      const result = extractAssetsListTags(content);

      expect(result).toEqual([
        {
          count: 3,
          ids: ["asset-1", "asset-2", "asset-3"],
          action: "added",
        },
        {
          count: 1,
          ids: ["asset-4"],
          action: "removed",
        },
      ]);
    });

    it("should return empty array if no asset list tags found", () => {
      const content = "No asset list tags in this content";
      const result = extractAssetsListTags(content);

      expect(result).toEqual([]);
    });

    it("should handle mixed content with other tags", () => {
      const content =
        'Booking scheduled for {% date value="2023-12-25T10:30:00.000Z" /%} with {% assets_list count=2 ids="asset-1,asset-2" action="added" /%}';
      const result = extractAssetsListTags(content);

      expect(result).toEqual([
        {
          count: 2,
          ids: ["asset-1", "asset-2"],
          action: "added",
        },
      ]);
    });
  });

  describe("Regular expressions", () => {
    describe("DATE_TAG_REGEX", () => {
      it("should match date tags with and without includeTime", () => {
        const content =
          '{% date value="2023-12-25T10:30:00.000Z" /%} and {% date value="2023-12-26T15:45:00.000Z" includeTime=false /%}';
        const matches = Array.from(content.matchAll(DATE_TAG_REGEX));

        expect(matches).toHaveLength(2);
        expect(matches[0][1]).toBe("2023-12-25T10:30:00.000Z");
        expect(matches[0][2]).toBeUndefined(); // includeTime not specified
        expect(matches[1][1]).toBe("2023-12-26T15:45:00.000Z");
        expect(matches[1][2]).toBe("false");
      });

      it("should not match malformed date tags", () => {
        const content = "{% date invalid /%}";
        const matches = Array.from(content.matchAll(DATE_TAG_REGEX));

        expect(matches).toHaveLength(0);
      });
    });

    describe("ASSETS_LIST_TAG_REGEX", () => {
      it("should match assets_list tags", () => {
        const content =
          '{% assets_list count=3 ids="asset-1,asset-2,asset-3" action="added" /%}';
        const matches = Array.from(content.matchAll(ASSETS_LIST_TAG_REGEX));

        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe("3");
        expect(matches[0][2]).toBe("asset-1,asset-2,asset-3");
        expect(matches[0][3]).toBe("added");
      });

      it("should not match malformed assets_list tags", () => {
        const content = "{% assets_list invalid /%}";
        const matches = Array.from(content.matchAll(ASSETS_LIST_TAG_REGEX));

        expect(matches).toHaveLength(0);
      });
    });
  });
});

// User Link Wrapper Tests
describe("wrapUserLinkForNote", () => {
  it("should wrap user with both first and last name", () => {
    const user = { id: "123", firstName: "John", lastName: "Doe" };
    const result = wrapUserLinkForNote(user);
    expect(result).toBe(
      `{% link to="/settings/team/users/123" text="John Doe" /%}`
    );
  });

  it("should handle user with only first name", () => {
    const user = { id: "456", firstName: "Jane", lastName: null };
    const result = wrapUserLinkForNote(user);
    expect(result).toBe(
      `{% link to="/settings/team/users/456" text="Jane" /%}`
    );
  });

  it("should handle user with only last name", () => {
    const user = { id: "789", firstName: null, lastName: "Smith" };
    const result = wrapUserLinkForNote(user);
    expect(result).toBe(
      `{% link to="/settings/team/users/789" text="Smith" /%}`
    );
  });

  it("should handle user with empty names", () => {
    const user = { id: "abc", firstName: "", lastName: "" };
    const result = wrapUserLinkForNote(user);
    expect(result).toBe(
      `{% link to="/settings/team/users/abc" text="Unknown User" /%}`
    );
  });

  it("should handle user with null names", () => {
    const user = { id: "def", firstName: null, lastName: null };
    const result = wrapUserLinkForNote(user);
    expect(result).toBe(
      `{% link to="/settings/team/users/def" text="Unknown User" /%}`
    );
  });

  it("should trim whitespace from names", () => {
    const user = { id: "ghi", firstName: "  John  ", lastName: "  Doe  " };
    const result = wrapUserLinkForNote(user);
    expect(result).toBe(
      `{% link to="/settings/team/users/ghi" text="John Doe" /%}`
    );
  });

  it("should handle special characters in names", () => {
    const user = { id: "jkl", firstName: "José", lastName: "García-López" };
    const result = wrapUserLinkForNote(user);
    expect(result).toBe(
      `{% link to="/settings/team/users/jkl" text="José García-López" /%}`
    );
  });

  it("should handle names with quotes by escaping them", () => {
    const user = {
      id: "mno",
      firstName: 'John "Johnny"',
      lastName: "O'Malley",
    };
    const result = wrapUserLinkForNote(user);
    expect(result).toBe(
      `{% link to="/settings/team/users/mno" text="John "Johnny" O'Malley" /%}`
    );
  });
});

// Generic Link Wrapper Tests
describe("wrapLinkForNote", () => {
  it("should wrap generic link with to and text", () => {
    const result = wrapLinkForNote("/bookings/123", "My Booking");
    expect(result).toBe(`{% link to="/bookings/123" text="My Booking" /%}`);
  });

  it("should handle asset links", () => {
    const result = wrapLinkForNote("/assets/456", "Laptop Dell XPS");
    expect(result).toBe(`{% link to="/assets/456" text="Laptop Dell XPS" /%}`);
  });

  it("should handle kit links", () => {
    const result = wrapLinkForNote("/kits/789", "Camera Kit");
    expect(result).toBe(`{% link to="/kits/789" text="Camera Kit" /%}`);
  });

  it("should handle links with special characters in text", () => {
    const result = wrapLinkForNote("/bookings/abc", 'Booking "Special Event"');
    expect(result).toBe(
      `{% link to="/bookings/abc" text="Booking "Special Event"" /%}`
    );
  });

  it("should handle external-style paths", () => {
    const result = wrapLinkForNote(
      "/settings/organization",
      "Organization Settings"
    );
    expect(result).toBe(
      `{% link to="/settings/organization" text="Organization Settings" /%}`
    );
  });
});

describe("wrapCustodianForNote", () => {
  it("should wrap custodian with user as link", () => {
    const custodian = {
      teamMember: {
        name: "John's Team Member",
        user: {
          id: "user123",
          firstName: "John",
          lastName: "Doe",
        },
      },
    };
    const result = wrapCustodianForNote(custodian);
    expect(result).toBe(
      `{% link to="/settings/team/users/user123" text="John Doe" /%}`
    );
  });

  it("should wrap custodian without user as bold text", () => {
    const custodian = {
      teamMember: {
        name: "External Team Member",
        user: null,
      },
    };
    const result = wrapCustodianForNote(custodian);
    expect(result).toBe("**External Team Member**");
  });

  it("should handle custodian with user having only firstName", () => {
    const custodian = {
      teamMember: {
        name: "Jane's Team Member",
        user: {
          id: "user456",
          firstName: "Jane",
          lastName: null,
        },
      },
    };
    const result = wrapCustodianForNote(custodian);
    expect(result).toBe(
      `{% link to="/settings/team/users/user456" text="Jane" /%}`
    );
  });

  it("should handle custodian with user having empty names", () => {
    const custodian = {
      teamMember: {
        name: "Anonymous Team Member",
        user: {
          id: "user789",
          firstName: "",
          lastName: "",
        },
      },
    };
    const result = wrapCustodianForNote(custodian);
    expect(result).toBe(
      `{% link to="/settings/team/users/user789" text="Unknown User" /%}`
    );
  });
});

describe("wrapDescriptionForNote", () => {
  it("should wrap single new description", () => {
    const result = wrapDescriptionForNote(null, "This is a new description");
    expect(result).toBe(
      `{% description newText="This is a new description" /%}`
    );
  });

  it("should wrap single old description", () => {
    const result = wrapDescriptionForNote("This is an old description", null);
    expect(result).toBe(
      `{% description oldText="This is an old description" /%}`
    );
  });

  it("should wrap both old and new descriptions for changes", () => {
    const result = wrapDescriptionForNote(
      "Old description text",
      "New description text"
    );
    expect(result).toBe(
      `{% description oldText="Old description text" newText="New description text" /%}`
    );
  });

  it("should handle descriptions with quotes by escaping them", () => {
    const oldText = 'Description with "quotes" in it';
    const newText = 'Another "quoted" description';
    const result = wrapDescriptionForNote(oldText, newText);
    expect(result).toBe(
      `{% description oldText="Description with &quot;quotes&quot; in it" newText="Another &quot;quoted&quot; description" /%}`
    );
  });

  it("should handle empty strings as falsy values", () => {
    const result = wrapDescriptionForNote("", "");
    expect(result).toBe(`{% description /%}`);
  });

  it("should handle non-empty strings properly", () => {
    const result = wrapDescriptionForNote("old", "new");
    expect(result).toBe(`{% description oldText="old" newText="new" /%}`);
  });

  it("should handle undefined values gracefully", () => {
    const result = wrapDescriptionForNote(undefined, undefined);
    expect(result).toBe(`{% description /%}`);
  });

  it("should handle mixed undefined and string values", () => {
    const result1 = wrapDescriptionForNote("Some text", undefined);
    expect(result1).toBe(`{% description oldText="Some text" /%}`);

    const result2 = wrapDescriptionForNote(undefined, "New text");
    expect(result2).toBe(`{% description newText="New text" /%}`);
  });

  it("should handle long descriptions", () => {
    const longText =
      "This is a very long description that goes on and on and on and contains multiple sentences with lots of detail about the booking and what it includes and excludes.";
    const result = wrapDescriptionForNote(null, longText);
    expect(result).toBe(
      `{% description newText="This is a very long description that goes on and on and on and contains multiple sentences with lots of detail about the booking and what it includes and excludes." /%}`
    );
  });

  it("should handle descriptions with special characters", () => {
    const textWithSpecial =
      "Description with émojis 🚀 and spëcial chars & symbols < > /";
    const result = wrapDescriptionForNote(textWithSpecial, null);
    expect(result).toBe(
      `{% description oldText="Description with émojis 🚀 and spëcial chars & symbols < > /" /%}`
    );
  });

  it("should handle newlines and multiple quotes", () => {
    const textWithNewlines =
      'Multi-line\ndescription with\n"multiple" "quotes"';
    const result = wrapDescriptionForNote(null, textWithNewlines);
    expect(result).toBe(
      `{% description newText="Multi-line\ndescription with\n&quot;multiple&quot; &quot;quotes&quot;" /%}`
    );
  });
});
