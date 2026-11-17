/**
 * Tests for the section anchor rules: which section the reader is on, and the
 * link to a section.
 *
 * @see {@link file://./section-anchor.ts}
 */
import { describe, expect, it } from "vitest";
import {
  SECTION_ACTIVE_LINE,
  resolveSectionInView,
  sectionUrl,
} from "./section-anchor";

/** Three stacked sections, 200px tall, the first starting `offset` px down. */
function sections(offset: number) {
  return ["notifications", "automation", "pdf-templates"].map((id, i) => ({
    id,
    top: offset + i * 200,
    bottom: offset + i * 200 + 200,
  }));
}

const viewportHeight = 800;

describe("resolveSectionInView", () => {
  it("is none while the reader is above the first section", () => {
    expect(
      resolveSectionInView({
        sections: sections(120),
        currentId: null,
        atBottom: false,
        viewportHeight,
      })
    ).toBeNull();
  });

  it("is the last section whose top has reached the active line", () => {
    // notifications at -250, automation at -50, pdf-templates at 150
    expect(
      resolveSectionInView({
        sections: sections(-250),
        currentId: null,
        atBottom: false,
        viewportHeight,
      })
    ).toBe("automation");
  });

  it("lands on the linked section after a link scrolls it to the top, however short it is", () => {
    // A link puts the section 16px from the top (scroll-mt-4); the next one
    // is only 40px further down and must not take over.
    const linked = [
      { id: "tags-requirement", top: 16, bottom: 46 },
      { id: "automation", top: 56, bottom: 400 },
    ];
    expect(SECTION_ACTIVE_LINE).toBeLessThan(56);
    expect(
      resolveSectionInView({
        sections: linked,
        currentId: "tags-requirement",
        atBottom: false,
        viewportHeight,
      })
    ).toBe("tags-requirement");
  });

  it("keeps a linked section near the bottom while it is in view", () => {
    // The page cannot scroll far enough to bring pdf-templates to the top.
    expect(
      resolveSectionInView({
        sections: sections(-250),
        currentId: "pdf-templates",
        atBottom: true,
        viewportHeight,
      })
    ).toBe("pdf-templates");
  });

  it("moves the hash down on a fast jump to the bottom, past a section still in view", () => {
    // The hash was on notifications; one frame later the page is at the
    // bottom with automation at the top and notifications still peeking in.
    expect(
      resolveSectionInView({
        sections: [
          { id: "notifications", top: -150, bottom: 50 },
          { id: "automation", top: 10, bottom: 400 },
        ],
        currentId: "notifications",
        atBottom: true,
        viewportHeight,
      })
    ).toBe("automation");
  });

  it("moves on at the bottom once the linked section has left the view", () => {
    expect(
      resolveSectionInView({
        sections: sections(-700),
        currentId: "notifications",
        atBottom: true,
        viewportHeight,
      })
    ).toBe("pdf-templates");
  });
});

describe("sectionUrl", () => {
  const location = {
    origin: "https://app.shelf.nu",
    pathname: "/settings/bookings",
    search: "?tab=1",
  };

  it("links to the section on the current page, keeping the query string", () => {
    expect(sectionUrl("automation", location)).toBe(
      "https://app.shelf.nu/settings/bookings?tab=1#automation"
    );
  });

  it("drops the hash for no section", () => {
    expect(sectionUrl(null, location)).toBe(
      "https://app.shelf.nu/settings/bookings?tab=1"
    );
  });
});
