/**
 * Tests for links the OS delivers: an https QR link records a scan like the
 * web QR page, a `shelf://` QR link records nothing and reads no position,
 * and only plain record ids name a screen.
 *
 * @see {@link file://./deep-links.ts}
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { before, beforeEach, describe, it, mock } from "node:test";

/** Lookup result the fake API returns for the next resolve. */
let lookupResult: {
  data: { qr: { asset?: { id: string } | null; kitId?: string | null } } | null;
  error: string | null;
} = { data: null, error: null };
const calls = {
  recordingResolve: 0,
  recordingCoordinates: [] as unknown[],
  lookup: [] as string[],
  coordinates: 0,
  pushed: [] as Array<[string, string | undefined]>,
  web: [] as string[],
};

/** The app's account counter, moved by hand. */
let accountGeneration = 0;

// why: the API layer reaches the network through Supabase and SecureStore.
// `qr` is the recording resolve; the fake counts calls to it.
mock.module(pathToFileURL(join(__dirname, "api.ts")).href, {
  namedExports: {
    api: {
      qr: async (...args: unknown[]) => {
        calls.recordingResolve += 1;
        calls.recordingCoordinates.push(args[2]);
        return lookupResult;
      },
      getScannedItem: async (qrId: string) => {
        calls.lookup.push(qrId);
        return lookupResult;
      },
    },
    getApiBaseUrl: () => "https://app.shelf.test",
    accountGeneration: { current: () => accountGeneration },
  },
});

// why: navigation drives expo-router and the in-app browser (native).
mock.module(pathToFileURL(join(__dirname, "navigation.ts")).href, {
  namedExports: {
    pushIntoTab: (tab: string, href?: string) => {
      calls.pushed.push([tab, href]);
    },
    openShelfWebUrl: async (url: string) => {
      calls.web.push(url);
    },
  },
});

// why: expo-location is native; counting reads proves no position is taken.
mock.module(pathToFileURL(join(__dirname, "scan-location.ts")).href, {
  namedExports: {
    getScanCoordinates: async () => {
      calls.coordinates += 1;
      return { latitude: 1, longitude: 2 };
    },
  },
});

// why: expo-linking is a native module. `parse` mirrors its shape: for a
// custom scheme the first segment is the hostname, for http(s) the path holds
// the resource; the path keeps its percent-encoding.
mock.module("expo-linking", {
  namedExports: {
    parse: (url: string) => {
      const parsed = new URL(url);
      return {
        scheme: parsed.protocol.replace(/:$/, ""),
        hostname: parsed.hostname || null,
        path: parsed.pathname.replace(/^\//, "") || null,
      };
    },
    getInitialURL: async () => null,
    addEventListener: () => ({ remove: () => {} }),
  },
});

let deepLinks: typeof import("./deep-links");

before(async () => {
  deepLinks = await import("./deep-links");
});

beforeEach(() => {
  lookupResult = { data: null, error: null };
  calls.recordingResolve = 0;
  calls.recordingCoordinates.length = 0;
  calls.lookup.length = 0;
  calls.coordinates = 0;
  calls.pushed.length = 0;
  calls.web.length = 0;
});

describe("resolveQrAndNavigate", () => {
  it("a shelf:// link opens the asset without recording or reading a position", async () => {
    lookupResult = { data: { qr: { asset: { id: "as_1" } } }, error: null };

    await deepLinks.resolveQrAndNavigate("qr_1");

    assert.deepEqual(calls.lookup, ["qr_1"]);
    assert.equal(calls.recordingResolve, 0);
    assert.equal(calls.coordinates, 0);
    assert.deepEqual(calls.pushed, [["/(tabs)/assets", "/(tabs)/assets/as_1"]]);
  });

  it("an https link from the connected server records the scan with its position", async () => {
    lookupResult = { data: { qr: { kitId: "kt_1" } }, error: null };

    await deepLinks.resolveQrAndNavigate("qr_1", "https://app.shelf.test");

    assert.equal(calls.recordingResolve, 1);
    assert.equal(calls.coordinates, 1);
    assert.deepEqual(calls.recordingCoordinates, [
      { latitude: 1, longitude: 2 },
    ]);
    assert.deepEqual(calls.lookup, []);
    assert.deepEqual(calls.pushed, [
      ["/(tabs)/assets", "/(tabs)/assets/kits/kt_1"],
    ]);
  });

  it("hands an unresolved code to the web QR page", async () => {
    lookupResult = { data: null, error: "Not found" };

    await deepLinks.resolveQrAndNavigate("qr_1");

    assert.equal(calls.recordingResolve, 0);
    assert.deepEqual(calls.web, ["https://app.shelf.test/qr/qr_1"]);
  });

  it("sends a code from another server to that server without a lookup", async () => {
    await deepLinks.resolveQrAndNavigate("qr_1", "https://other.example");

    assert.deepEqual(calls.lookup, []);
    assert.deepEqual(calls.web, ["https://other.example/qr/qr_1"]);
  });
});

describe("parseDeepLink", () => {
  it("reads custom-scheme and https links with plain ids", () => {
    assert.deepEqual(deepLinks.parseDeepLink("shelf://assets/as_1"), {
      type: "asset",
      id: "as_1",
    });
    assert.deepEqual(deepLinks.parseDeepLink("shelf://assets/kits/kt_1"), {
      type: "kit",
      id: "kt_1",
    });
    assert.deepEqual(deepLinks.parseDeepLink("shelf://bookings/bk_1"), {
      type: "booking",
      id: "bk_1",
    });
    assert.deepEqual(deepLinks.parseDeepLink("shelf://qr/qr_1"), {
      type: "qr",
      id: "qr_1",
      origin: undefined,
    });
    assert.deepEqual(
      deepLinks.parseDeepLink("https://app.shelf.test/qr/qr_1"),
      { type: "qr", id: "qr_1", origin: "https://app.shelf.test" }
    );
    assert.deepEqual(deepLinks.parseDeepLink("shelf://scanner/v1.2"), {
      type: "scanner",
    });
  });

  it("names nothing for an id that is not a plain record id", () => {
    for (const url of [
      "shelf://assets/as_1%3ForgId%3Dother",
      "shelf://bookings/bk_1%2Fmodel-requests",
      "shelf://audits/au_1%23x",
      "shelf://assets/kits/kt_1%26orgId%3Dother",
      "shelf://qr/qr_1%2F..",
      "shelf://assets/as_1?orgId=other%2Fworkspace",
    ]) {
      assert.deepEqual(deepLinks.parseDeepLink(url), { type: "unknown" }, url);
    }
  });
});

describe("resolveQrAndNavigate across a sign-out", () => {
  it("opens nothing when the session ends during the lookup", async () => {
    lookupResult = { data: { qr: { asset: { id: "as_1" } } }, error: null };
    const pending = deepLinks.resolveQrAndNavigate("qr_1");
    accountGeneration += 1; // signed out (or another account) mid-lookup
    await pending;

    assert.deepEqual(calls.pushed, []);
    assert.deepEqual(calls.web, []);
  });
});
