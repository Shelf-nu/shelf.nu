/**
 * Tests for `googleMapsSearchUrl`: the link to a scan's location on Google
 * Maps, with the stored coordinates encoded as one query value.
 *
 * @see {@link file://./maps-link.ts}
 */
import { describe, expect, it } from "vitest";

import { googleMapsSearchUrl } from "./maps-link";

describe("googleMapsSearchUrl", () => {
  it("links to the point on Google Maps", () => {
    const url = new URL(googleMapsSearchUrl("42.6977", "23.3219"));

    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/maps/search/");
    expect(url.searchParams.get("query")).toBe("42.6977,23.3219");
  });

  it("keeps a malformed stored value inside the one query value", () => {
    const url = new URL(googleMapsSearchUrl("1&query=elsewhere", "2"));

    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.getAll("query")).toEqual(["1&query=elsewhere,2"]);
  });
});
