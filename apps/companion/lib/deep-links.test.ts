/**
 * Tests for links the OS delivers: an https QR link records a scan like the
 * web QR page, a `shelf://` QR link records nothing and reads no position,
 * only plain record ids name a screen, and the deep-link hook opens every
 * link the router leaves alone, once, anchored in its tab.
 *
 * @see {@link file://./deep-links.ts}
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { before, beforeEach, describe, it, mock } from "node:test";
import { act, createElement } from "react";
import { create } from "react-test-renderer";

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
  routes: [] as string[],
};

/** What the next mount's `getInitialURL` resolves with, settled by the test. */
let resolveInitialUrl: (url: string | null) => void = () => {};
/** The `url` listener the hook added, so a test can deliver a link. */
let urlListener: ((event: { url: string }) => void) | null = null;

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
    openLinkedRoute: (route: string) => {
      calls.routes.push(route);
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
    getInitialURL: () =>
      new Promise<string | null>((resolve) => {
        resolveInitialUrl = resolve;
      }),
    addEventListener: (
      _type: string,
      listener: (event: { url: string }) => void
    ) => {
      urlListener = listener;
      return {
        remove: () => {
          urlListener = null;
        },
      };
    },
  },
});

let deepLinks: typeof import("./deep-links");
let routing: typeof import("./link-routing");

before(async () => {
  deepLinks = await import("./deep-links");
  routing = await import("./link-routing");
  // React only flushes `act` updates synchronously in an act environment.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  lookupResult = { data: null, error: null };
  calls.recordingResolve = 0;
  calls.recordingCoordinates.length = 0;
  calls.lookup.length = 0;
  calls.coordinates = 0;
  calls.pushed.length = 0;
  calls.web.length = 0;
  calls.routes.length = 0;
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

describe("links the router leaves alone", () => {
  it("are all opened by the hook when they name a screen, with the kind parseDeepLink reads", () => {
    const urls = [
      "https://app.shelf.nu/assets/as_1/overview",
      "https://app.shelf.nu/assets/kits/kt_1",
      "https://app.shelf.nu/bookings/bk_1",
      "https://app.shelf.nu/bookings/",
      "https://app.shelf.nu/assets/",
      "https://app.shelf.nu/assets/kits",
      "https://app.shelf.nu/audits/au_1",
      "https://app.shelf.nu/assets/new?qrId=qr_1",
      "https://app.shelf.nu/qr/qr_1",
      "shelf://assets/as_1",
      "shelf://kits/kt_1",
      "shelf://bookings",
      "shelf://bookings/bk_1",
      "shelf://audits",
      "shelf://scanner",
      "shelf://qr/qr_1",
    ];
    for (const url of urls) {
      assert.equal(
        routing.systemPathFor({ path: url, initial: false }),
        null,
        `${url} is the hook's`
      );
      const action = routing.linkAction(url, deepLinks.parseDeepLink(url));
      assert.notEqual(action.kind, "none", `${url} opens something`);
    }
  });
});

/** A component that only runs the deep-link hook. */
function Harness() {
  deepLinks.useDeepLinkHandler();
  return null;
}

/**
 * Mounts the hook with fake timers, runs `body`, then unmounts and restores
 * the timers.
 *
 * @param body - the test steps, given a way to let pending promises settle
 */
async function withHook(body: (settle: () => Promise<void>) => Promise<void>) {
  mock.timers.enable({ apis: ["setTimeout"] });
  let renderer!: ReturnType<typeof create>;
  const settle = () => act(async () => {});
  try {
    await act(async () => {
      renderer = create(createElement(Harness));
    });
    await body(settle);
  } finally {
    act(() => renderer.unmount());
    mock.timers.reset();
  }
}

describe("useDeepLinkHandler", () => {
  it("opens a link that arrives while the app runs, anchored in its tab", async () => {
    await withHook(async (settle) => {
      resolveInitialUrl(null);
      await settle();
      act(() => urlListener?.({ url: "shelf://bookings/bk_1" }));
      act(() => urlListener?.({ url: "https://app.shelf.nu/assets/" }));
      assert.deepEqual(calls.routes, ["/bookings/bk_1", "/assets"]);
    });
  });

  it("opens the launch link once, after the delay, when it also arrives as an event", async () => {
    await withHook(async (settle) => {
      resolveInitialUrl("shelf://audits/au_1");
      await settle();
      act(() => urlListener?.({ url: "shelf://audits/au_1" }));
      assert.deepEqual(calls.routes, []);
      act(() => mock.timers.tick(500));
      assert.deepEqual(calls.routes, ["/audits/au_1"]);
    });
  });

  it("opens the launch link once when its event arrives before getInitialURL resolves", async () => {
    await withHook(async (settle) => {
      act(() => urlListener?.({ url: "shelf://audits/au_1" }));
      resolveInitialUrl("shelf://audits/au_1");
      await settle();
      act(() => mock.timers.tick(500));
      assert.deepEqual(calls.routes, ["/audits/au_1"]);
    });
  });

  it("keeps a different launch link closed when a newer link arrived before getInitialURL resolved", async () => {
    await withHook(async (settle) => {
      act(() => urlListener?.({ url: "shelf://bookings/bk_1" }));
      resolveInitialUrl("shelf://audits/au_1");
      await settle();
      act(() => mock.timers.tick(500));
      assert.deepEqual(calls.routes, ["/bookings/bk_1"]);
    });
  });

  it("lets a newer link replace the launch link, and still opens the launch link when tapped later", async () => {
    await withHook(async (settle) => {
      resolveInitialUrl("shelf://audits/au_1");
      await settle();
      act(() => urlListener?.({ url: "shelf://bookings/bk_1" }));
      act(() => mock.timers.tick(500));
      assert.deepEqual(calls.routes, ["/bookings/bk_1"]);
      act(() => urlListener?.({ url: "shelf://audits/au_1" }));
      assert.deepEqual(calls.routes, ["/bookings/bk_1", "/audits/au_1"]);
    });
  });

  it("opens the launch link again when it is tapped after it opened", async () => {
    await withHook(async (settle) => {
      resolveInitialUrl("shelf://audits/au_1");
      await settle();
      act(() => mock.timers.tick(500));
      act(() => urlListener?.({ url: "shelf://audits/au_1" }));
      assert.deepEqual(calls.routes, ["/audits/au_1", "/audits/au_1"]);
    });
  });

  it("resolves a QR link through the API instead of opening a route", async () => {
    await withHook(async (settle) => {
      resolveInitialUrl(null);
      await settle();
      lookupResult = { data: { qr: { asset: { id: "as_1" } } }, error: null };
      act(() => urlListener?.({ url: "shelf://qr/qr_1" }));
      await settle();
      assert.deepEqual(calls.routes, []);
      assert.deepEqual(calls.lookup, ["qr_1"]);
    });
  });
});
