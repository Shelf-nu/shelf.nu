/**
 * Tests for the client capability header parser.
 *
 * @see {@link file://./capabilities.server.ts}
 */

import { describe, expect, it } from "vitest";

import { clientHasCapability } from "./capabilities.server";

/** A request carrying the given capabilities header, or none. */
function requestWith(header?: string): Request {
  const headers = new Headers();
  if (header !== undefined) headers.set("X-Shelf-Capabilities", header);
  return new Request("https://example.test/api/mobile/bookings", { headers });
}

describe("clientHasCapability", () => {
  it("is false when the header is absent", () => {
    expect(clientHasCapability(requestWith(), "booking-sources")).toBe(false);
  });

  it("is false for an empty header", () => {
    expect(clientHasCapability(requestWith(""), "booking-sources")).toBe(false);
  });

  it("finds the token alone", () => {
    expect(
      clientHasCapability(requestWith("booking-sources"), "booking-sources")
    ).toBe(true);
  });

  it("finds the token in a comma-separated list with whitespace", () => {
    expect(
      clientHasCapability(
        requestWith("other-thing ,  booking-sources , more"),
        "booking-sources"
      )
    ).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(
      clientHasCapability(requestWith("Booking-Sources"), "booking-sources")
    ).toBe(true);
  });

  it("reads the header name case-insensitively", () => {
    const request = new Request("https://example.test/x", {
      headers: { "x-shelf-capabilities": "booking-sources" },
    });
    expect(clientHasCapability(request, "booking-sources")).toBe(true);
  });

  it("is false when only other tokens or a longer token are listed", () => {
    expect(
      clientHasCapability(
        requestWith("booking-sources-v2, sources"),
        "booking-sources"
      )
    ).toBe(false);
  });
});
