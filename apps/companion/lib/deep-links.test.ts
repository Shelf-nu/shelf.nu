/**
 * Tests for QR links the OS delivers: they open the asset or kit without
 * recording a scan and without reading the device position.
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
  lookup: [] as string[],
  coordinates: 0,
  pushed: [] as Array<[string, string | undefined]>,
  web: [] as string[],
};

// why: the API layer reaches the network through Supabase and SecureStore.
// `qr` is the recording resolve and must never run for a link.
mock.module(pathToFileURL(join(__dirname, "api.ts")).href, {
  namedExports: {
    api: {
      qr: async () => {
        calls.recordingResolve += 1;
        throw new Error("a link must not record a scan");
      },
      getScannedItem: async (qrId: string) => {
        calls.lookup.push(qrId);
        return lookupResult;
      },
    },
    getApiBaseUrl: () => "https://app.shelf.test",
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

// why: expo-linking is a native module; these tests call the resolver directly.
mock.module("expo-linking", {
  namedExports: {
    parse: () => ({}),
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
  calls.lookup.length = 0;
  calls.coordinates = 0;
  calls.pushed.length = 0;
  calls.web.length = 0;
});

describe("resolveQrAndNavigate", () => {
  it("opens an asset-linked code without recording or reading a position", async () => {
    lookupResult = { data: { qr: { asset: { id: "as_1" } } }, error: null };

    await deepLinks.resolveQrAndNavigate("qr_1");

    assert.deepEqual(calls.lookup, ["qr_1"]);
    assert.equal(calls.recordingResolve, 0);
    assert.equal(calls.coordinates, 0);
    assert.deepEqual(calls.pushed, [["/(tabs)/assets", "/(tabs)/assets/as_1"]]);
  });

  it("opens a kit-linked code the same way", async () => {
    lookupResult = { data: { qr: { kitId: "kt_1" } }, error: null };

    await deepLinks.resolveQrAndNavigate("qr_1", "https://app.shelf.test");

    assert.equal(calls.recordingResolve, 0);
    assert.equal(calls.coordinates, 0);
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
