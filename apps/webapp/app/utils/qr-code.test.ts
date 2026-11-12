/**
 * `getShelfQrId` is the one rule for "is this a Shelf QR", shared by the
 * scanner and the asset filter. Each case asserts the id it reads, or `null`
 * for a value that is somebody else's code.
 *
 * Runs under Node, where our origin is `SERVER_URL` (`http://localhost:3000`
 * in the test env).
 *
 * @see {@link file://./qr-code.ts}
 */
import { describe, expect, it, vi } from "vitest";
import type * as EnvModule from "~/utils/env";

// why: the test env sets no shortener, and a Shelf label can carry one.
vi.mock("~/utils/env", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvModule>()),
  URL_SHORTENER: "short.example",
}));

import { getShelfQrId } from "./qr-code";

/** A value `isQrId` accepts: 10 characters, lowercase, leading letter. */
const QR_ID = "abc1234567";

describe("getShelfQrId", () => {
  it.each([
    ["a raw QR id", QR_ID, QR_ID],
    ["our own /qr/ link", `http://localhost:3000/qr/${QR_ID}`, QR_ID],
    // Ours to report as malformed, so the id is returned even though isQrId
    // rejects it.
    [
      "our own /qr/ link with a malformed id",
      "http://localhost:3000/qr/BADID",
      "BADID",
    ],
    ["the shortener link", `https://short.example/${QR_ID}`, QR_ID],
  ])("reads the id from %s", (_name, value, expected) => {
    expect(getShelfQrId(value)).toBe(expected);
  });

  it.each([
    ["a /qr/ link on another host", `https://other.example/qr/${QR_ID}`],
    ["a host that only starts like ours", `http://localhost:30001/qr/${QR_ID}`],
    ["a shortener look-alike", `https://short-example/${QR_ID}`],
    ["the shortener over http", `http://short.example/${QR_ID}`],
    ["a trailing slash", `http://localhost:3000/qr/${QR_ID}/`],
    ["a query string", `http://localhost:3000/qr/${QR_ID}?a=b`],
    ["plain text", "PART-4421"],
    ["an empty string", ""],
  ])("answers null for %s", (_name, value) => {
    expect(getShelfQrId(value)).toBeNull();
  });
});
