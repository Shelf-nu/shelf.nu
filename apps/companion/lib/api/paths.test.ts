/**
 * Tests for the mobile API path builders: an id is always one path segment
 * and `orgId` is always the caller's.
 *
 * @see ./paths.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mobilePaths, pathSegment } from "./paths";

/** Ids that would reshape a path or query if spliced in raw. */
const RESHAPING_IDS = [
  "abc?orgId=other",
  "abc&orgId=other",
  "../team-members",
  "abc/bookings",
  "abc#frag",
  "abc%3ForgId%3Dother",
];

/** Splits a built path the way the server's router does. */
function parse(path: string) {
  const url = new URL(path, "https://shelf.test");
  return {
    segments: url.pathname.split("/").filter(Boolean),
    params: url.searchParams,
    hash: url.hash,
  };
}

describe("pathSegment", () => {
  it("leaves a plain id unchanged", () => {
    assert.equal(pathSegment("clx1abc_DEF-2"), "clx1abc_DEF-2");
  });

  it("encodes every reserved character", () => {
    assert.equal(pathSegment("a/b?c#d&e%f"), "a%2Fb%3Fc%23d%26e%25f");
  });
});

describe("mobilePaths", () => {
  const builders: Array<[string, (id: string) => string, string[]]> = [
    ["asset", (id) => mobilePaths.asset(id, "org_1"), ["assets"]],
    ["audit", (id) => mobilePaths.audit(id, "org_1"), ["audits"]],
    [
      "auditEvidence",
      (id) => mobilePaths.auditEvidence(id, "org_1"),
      ["audits"],
    ],
    ["booking", (id) => mobilePaths.booking(id, "org_1"), ["bookings"]],
    [
      "bookingModelRequests",
      (id) => mobilePaths.bookingModelRequests(id, "org_1"),
      ["bookings"],
    ],
    ["kit", (id) => mobilePaths.kit(id, "org_1"), ["kits"]],
  ];

  for (const [name, build, prefix] of builders) {
    for (const id of RESHAPING_IDS) {
      it(`${name}: ${JSON.stringify(id)} stays one segment`, () => {
        const { segments, params, hash } = parse(build(id));
        assert.deepEqual(segments.slice(0, 3), ["api", "mobile", ...prefix]);
        assert.equal(decodeURIComponent(segments[3]), id);
        assert.deepEqual(params.getAll("orgId"), ["org_1"]);
        assert.equal(hash, "");
      });
    }
  }

  it("keeps the endpoint suffix after the id", () => {
    assert.equal(
      mobilePaths.auditEvidence("au_1", "org_1", "aa_1"),
      "/api/mobile/audits/au_1/evidence?orgId=org_1&auditAssetId=aa_1"
    );
    assert.equal(
      mobilePaths.bookingModelRequests("bk_1", "org_1"),
      "/api/mobile/bookings/bk_1/model-requests?orgId=org_1"
    );
  });

  it("builds today's paths for plain ids", () => {
    assert.equal(
      mobilePaths.asset("as_1", "org_1"),
      "/api/mobile/assets/as_1?orgId=org_1"
    );
    assert.equal(
      mobilePaths.audit("au_1", "org_1"),
      "/api/mobile/audits/au_1?orgId=org_1"
    );
    assert.equal(
      mobilePaths.booking("bk_1", "org_1"),
      "/api/mobile/bookings/bk_1?orgId=org_1"
    );
    assert.equal(
      mobilePaths.kit("kt_1", "org_1"),
      "/api/mobile/kits/kt_1?orgId=org_1"
    );
  });

  it("puts the image upload's asset id in the query, once", () => {
    const { params } = parse(
      mobilePaths.assetImage("as_1&orgId=other", "org_1")
    );
    assert.deepEqual(params.getAll("orgId"), ["org_1"]);
    assert.deepEqual(params.getAll("assetId"), ["as_1&orgId=other"]);
  });
});
