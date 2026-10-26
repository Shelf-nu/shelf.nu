import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONTENT_MAX_WIDTH,
  FORM_MAX_WIDTH,
  contentGutter,
  isTabletScreen,
  showsTabSidebar,
} from "./content-column";

describe("contentGutter", () => {
  it("adds no padding on a phone", () => {
    assert.equal(contentGutter(390), 0);
    assert.equal(contentGutter(430), 0);
  });

  it("adds no padding at exactly the column width", () => {
    assert.equal(contentGutter(CONTENT_MAX_WIDTH), 0);
  });

  it("centres the column on a wide window", () => {
    // iPad Air 11" in landscape is 1180 pt wide.
    assert.equal(contentGutter(1180), 230);
    // Pixel Tablet in portrait is 800 dp wide.
    assert.equal(contentGutter(800), 40);
  });

  it("centres a narrower column when given one", () => {
    assert.equal(contentGutter(800, FORM_MAX_WIDTH), 160);
    assert.equal(contentGutter(390, FORM_MAX_WIDTH), 0);
  });

  it("rounds down so the column is never narrower than the cap", () => {
    const gutter = contentGutter(1001);
    assert.ok(1001 - gutter * 2 >= CONTENT_MAX_WIDTH);
  });
});

describe("isTabletScreen", () => {
  it("counts phones as phones in either orientation", () => {
    assert.equal(isTabletScreen(390, 844), false);
    assert.equal(isTabletScreen(932, 430), false);
  });

  it("counts tablets as tablets in either orientation", () => {
    assert.equal(isTabletScreen(820, 1180), true);
    assert.equal(isTabletScreen(1280, 800), true);
    // iPad mini, the smallest iPad.
    assert.equal(isTabletScreen(744, 1133), true);
  });
});

describe("showsTabSidebar", () => {
  it("keeps the bottom tab bar on phones and upright tablets", () => {
    assert.equal(showsTabSidebar(430), false);
    // iPad Air 11" and Pixel Tablet, upright.
    assert.equal(showsTabSidebar(820), false);
    assert.equal(showsTabSidebar(800), false);
  });

  it("shows the sidebar on tablets held sideways", () => {
    assert.equal(showsTabSidebar(1180), true);
    assert.equal(showsTabSidebar(1280), true);
  });

  it("shows the sidebar on a 13-inch iPad held upright", () => {
    assert.equal(showsTabSidebar(1024), true);
  });
});
