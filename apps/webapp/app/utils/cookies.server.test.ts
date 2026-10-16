// @vitest-environment node
/**
 * Tests for the host-only `user-prefs` expiry shim.
 *
 * The shim exists to clear a leftover host-only cookie once `user-prefs`
 * became domain-scoped. It is emitted on every authenticated page load, so
 * when there is no domain to scope to it targets the same cookie the response
 * is writing — and every stored preference (sidebar notice card, the Team
 * upgrade banner's fold) is discarded on the next request.
 *
 * That is the state of any deployment leaving `COOKIE_DOMAIN` unset, local
 * development included.
 *
 * @see {@link file://./cookies.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the shim reads `COOKIE_DOMAIN` per call, so a getter lets each test set
// the deployment shape without re-importing the module under test.
const envMock = vi.hoisted(() => ({ COOKIE_DOMAIN: undefined as unknown }));
vi.mock("./env", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./env");
  return {
    ...actual,
    get COOKIE_DOMAIN() {
      return envMock.COOKIE_DOMAIN;
    },
  };
});

// why: cookies.server transitively imports asset/utils.server, which
// initializes Prisma at import time.
vi.mock("~/modules/asset/utils.server", () => ({
  advancedFilterFormatSchema: {},
}));

const { expireHostOnlyUserPrefsCookie } = await import("./cookies.server");

describe("expireHostOnlyUserPrefsCookie", () => {
  beforeEach(() => {
    envMock.COOKIE_DOMAIN = undefined;
  });

  it("emits nothing when there is no cookie domain", () => {
    // The real cookie is host-only here, so the expiry would delete it. This
    // is the case that silently wiped preferences on every page load.
    expect(expireHostOnlyUserPrefsCookie()).toEqual([]);
  });

  it("expires the host-only leftover when the cookie is domain-scoped", () => {
    envMock.COOKIE_DOMAIN = ".shelf.nu";

    const headers = expireHostOnlyUserPrefsCookie();

    expect(headers).toHaveLength(1);
    const [name, value] = headers[0];
    expect(name).toBe("Set-Cookie");
    expect(value).toContain("Max-Age=0");
    // No Domain attribute: that is what makes it target the OLD cookie and
    // leave the domain-scoped one alone.
    expect(value).not.toMatch(/Domain=/i);
  });
});

const {
  createAdvancedAssetFilterCookie,
  createFilterCookie,
  expireListPreferenceCookies,
  getAdvancedFiltersFromRequest,
  getFiltersFromRequest,
  userPrefs,
} = await import("./cookies.server");

/**
 * Builds a request for a list page carrying the given cookies.
 *
 * @param url - The page URL, with whatever query the person typed
 * @param cookies - Raw `name=value` pairs for the Cookie header
 */
function listRequest(url: string, cookies: string[] = []) {
  return new Request(url, {
    headers: cookies.length ? { Cookie: cookies.join("; ") } : {},
  });
}

/**
 * Reads the value a `Set-Cookie` header stores, the way the next request
 * would send it back.
 *
 * @param setCookieHeader - The serialized `Set-Cookie` value
 */
function storedValue(setCookieHeader: string) {
  return setCookieHeader.split(";")[0];
}

/** The three simple list cookies, each as its index loader configures it. */
const SIMPLE_LISTS = [
  { name: "assetFilter_v2", path: "/" },
  { name: "bookingFilter_v2", path: "/" },
  { name: "kitFilter_v2", path: "/" },
] as const;

describe("filter cookies never keep a typed search", () => {
  it.each(SIMPLE_LISTS)(
    "$name saves the column filters and the page size, not the search",
    async (cookie) => {
      const { filters, serializedCookie } = await getFiltersFromRequest(
        listRequest(
          "http://localhost/list?s=ZZ+Test&status=ONGOING&per_page=2&page=3"
        ),
        "org-1",
        cookie
      );

      // The current page still searches: only the remembered copy drops it.
      expect(new URLSearchParams(filters).get("s")).toBe("ZZ Test");

      const saved = await createFilterCookie({
        orgId: "org-1",
        ...cookie,
      }).parse(storedValue(serializedCookie as string));
      expect(new URLSearchParams(saved)).toEqual(
        new URLSearchParams("status=ONGOING&per_page=2")
      );
    }
  );

  it.each(SIMPLE_LISTS)(
    "$name does not restore a search an older cookie still holds",
    async (cookie) => {
      const filterCookie = createFilterCookie({ orgId: "org-1", ...cookie });
      const stale = storedValue(
        await filterCookie.serialize("s=ZZ+Test&status=ONGOING")
      );

      const { filters, redirectNeeded } = await getFiltersFromRequest(
        listRequest("http://localhost/list", [stale]),
        "org-1",
        cookie
      );

      expect(redirectNeeded).toBe(true);
      expect(filters).toBe("status=ONGOING");
    }
  );

  it("does not redirect at all when the old cookie held only a search", async () => {
    const cookie = SIMPLE_LISTS[1];
    const stale = storedValue(
      await createFilterCookie({ orgId: "org-1", ...cookie }).serialize(
        "s=ZZ+Test"
      )
    );

    const { redirectNeeded } = await getFiltersFromRequest(
      listRequest("http://localhost/bookings", [stale]),
      "org-1",
      cookie
    );

    expect(redirectNeeded).toBe(false);
  });

  it("forgets the remembered filters when the URL holds only a search", async () => {
    const cookie = SIMPLE_LISTS[1];
    const filterCookie = createFilterCookie({ orgId: "org-1", ...cookie });
    const remembered = storedValue(
      await filterCookie.serialize("status=ONGOING")
    );

    const { serializedCookie } = await getFiltersFromRequest(
      listRequest("http://localhost/bookings?s=foo", [remembered]),
      "org-1",
      cookie
    );

    // Otherwise the next plain visit restores a status the URL dropped.
    expect(serializedCookie).toMatch(/^org-1_bookingFilter_v2=;.*Max-Age=0/);
    expect(serializedCookie).toMatch(/Path=\//);
  });

  it("writes nothing for a search-only URL when nothing is remembered", async () => {
    const { serializedCookie } = await getFiltersFromRequest(
      listRequest("http://localhost/bookings?s=foo"),
      "org-1",
      SIMPLE_LISTS[1]
    );

    expect(serializedCookie).toBeNull();
  });

  // Advanced mode: no configured columns, so `status` passes through as a
  // plain param and the test needs no column-format validation.
  const settings = { columns: [] } as never;

  it("the Advanced assets cookie saves the filters, not the search", async () => {
    const { serializedCookie } = await getAdvancedFiltersFromRequest(
      listRequest("http://localhost/assets?s=laptop&status=is:AVAILABLE"),
      "org-1",
      settings
    );

    const saved = await createAdvancedAssetFilterCookie("org-1").parse(
      storedValue(serializedCookie as string)
    );
    expect(new URLSearchParams(saved)).toEqual(
      new URLSearchParams("status=is:AVAILABLE")
    );
  });

  it("the Advanced assets cookie does not restore an older saved search", async () => {
    const stale = storedValue(
      await createAdvancedAssetFilterCookie("org-1").serialize(
        "s=laptop&status=is:AVAILABLE"
      )
    );

    const { filters, redirectNeeded } = await getAdvancedFiltersFromRequest(
      listRequest("http://localhost/assets", [stale]),
      "org-1",
      settings
    );

    expect(redirectNeeded).toBe(true);
    expect(filters).toBe("status=is%3AAVAILABLE");
  });

  it("the Advanced assets cookie is forgotten when the URL holds only a search", async () => {
    const remembered = storedValue(
      await createAdvancedAssetFilterCookie("org-1").serialize(
        "status=is:AVAILABLE"
      )
    );

    const { serializedCookie } = await getAdvancedFiltersFromRequest(
      listRequest("http://localhost/assets?s=laptop", [remembered]),
      "org-1",
      settings
    );

    expect(serializedCookie).toMatch(
      /^org-1_advancedAssetFilter_v2=;.*Max-Age=0/
    );
  });
});

describe("expireListPreferenceCookies", () => {
  beforeEach(() => {
    envMock.COOKIE_DOMAIN = undefined;
  });

  /**
   * Collects the cookie names the headers expire.
   *
   * @param headers - The `Set-Cookie` tuples returned by the helper
   */
  function expiredNames(headers: Array<[string, string]>) {
    return headers
      .filter(([, value]) => /Max-Age=0/i.test(value))
      .map(([, value]) => value.split("=")[0]);
  }

  it("expires every list filter cookie of every workspace and the user prefs", async () => {
    const headers = await expireListPreferenceCookies(
      listRequest("http://localhost/logout", [
        "org-1_assetFilter_v2=YQ%3D%3D",
        "org-1_advancedAssetFilter_v2=YQ%3D%3D",
        "org-2_bookingFilter_v2=YQ%3D%3D",
        "org-3_kitFilter_v2=YQ%3D%3D",
        "user-prefs=eyJwZXJQYWdlIjoyfQ%3D%3D",
        "__session=keep-me",
        "selected-organization-id=org-1",
      ]),
      { event: "sign-out" }
    );

    expect(headers.every(([name]) => name === "Set-Cookie")).toBe(true);
    expect(expiredNames(headers).sort()).toEqual(
      [
        "org-1_advancedAssetFilter_v2",
        "org-1_assetFilter_v2",
        "org-2_bookingFilter_v2",
        "org-3_kitFilter_v2",
        "user-prefs",
      ].sort()
    );
    // Filter cookies live on the root path; an expiry on any other path
    // would leave them in place.
    headers
      .filter(([, value]) => value.includes("Filter_v2"))
      .forEach(([, value]) => expect(value).toMatch(/Path=\//));
  });

  it("also expires the host-only user prefs leftover when the cookie is domain-scoped", async () => {
    envMock.COOKIE_DOMAIN = ".shelf.nu";

    const headers = await expireListPreferenceCookies(
      listRequest("http://localhost/logout", ["user-prefs=x"]),
      { event: "sign-out" }
    );

    // One expiry for the real cookie, one for the host-only leftover.
    expect(expiredNames(headers)).toEqual(["user-prefs", "user-prefs"]);
  });

  it("sends nothing when the browser remembers no list settings", async () => {
    const headers = await expireListPreferenceCookies(
      listRequest("http://localhost/logout", ["__session=keep-me"]),
      { event: "sign-out" }
    );

    expect(headers).toEqual([]);
  });

  /**
   * Reads the user prefs a `Set-Cookie` value stores.
   *
   * @param headers - The `Set-Cookie` tuples returned by the helper
   */
  async function storedUserPrefs(headers: Array<[string, string]>) {
    const header = headers.find(([, value]) => value.startsWith("user-prefs="));
    return userPrefs.parse(storedValue(header?.[1] ?? ""));
  }

  it("on sign-in keeps the person's own UI choices and forgets the page size", async () => {
    const prefs = storedValue(
      await userPrefs.serialize({
        perPage: 2,
        minimizedSidebar: true,
        skipOnboardingChecklist: "skipped",
      })
    );

    const headers = await expireListPreferenceCookies(
      listRequest("http://localhost/login", [
        "org-1_bookingFilter_v2=YQ%3D%3D",
        prefs,
      ]),
      { event: "sign-in" }
    );

    expect(expiredNames(headers)).toEqual(["org-1_bookingFilter_v2"]);
    expect(await storedUserPrefs(headers)).toEqual({
      minimizedSidebar: true,
      skipOnboardingChecklist: "skipped",
    });
  });

  it("on sign-in expires the user prefs when the page size was all they held", async () => {
    const prefs = storedValue(await userPrefs.serialize({ perPage: 2 }));

    const headers = await expireListPreferenceCookies(
      listRequest("http://localhost/login", [prefs]),
      { event: "sign-in" }
    );

    expect(expiredNames(headers)).toEqual(["user-prefs"]);
  });

  it("on sign-out expires the person's UI choices too", async () => {
    const prefs = storedValue(
      await userPrefs.serialize({ perPage: 2, minimizedSidebar: true })
    );

    const headers = await expireListPreferenceCookies(
      listRequest("http://localhost/logout", [prefs]),
      { event: "sign-out" }
    );

    expect(expiredNames(headers)).toEqual(["user-prefs"]);
  });
});

const { initializePerPageCookieOnLayout, updateCookieWithPerPage, userPrefs } =
  await import("./cookies.server");

/**
 * Builds a request whose `user-prefs` cookie holds the given page size.
 *
 * @param perPage - The stored page size, or undefined for no cookie
 */
async function prefsRequest(perPage?: number) {
  const cookie =
    perPage === undefined
      ? []
      : [storedValue(await userPrefs.serialize({ perPage }))];
  return listRequest("http://localhost/locations", cookie);
}

describe("the remembered page size is always one the list offers", () => {
  it("saves a size the per-page menu offers", async () => {
    const cookie = await updateCookieWithPerPage(await prefsRequest(20), 50);

    expect(cookie.perPage).toBe(50);
  });

  it("ignores a size from the URL the menu does not offer", async () => {
    const cookie = await updateCookieWithPerPage(await prefsRequest(50), 3);

    // The person's own choice stands.
    expect(cookie.perPage).toBe(50);
  });

  it("puts a stuck unsupported size back to the default", async () => {
    const cookie = await updateCookieWithPerPage(await prefsRequest(2), 0);

    expect(cookie.perPage).toBe(20);
  });

  it("starts at the default when nothing is stored", async () => {
    const cookie = await updateCookieWithPerPage(await prefsRequest(), 0);

    expect(cookie.perPage).toBe(20);
  });

  it("the layout also puts a stuck size back to the default", async () => {
    const cookie = await initializePerPageCookieOnLayout(await prefsRequest(2));

    expect(cookie.perPage).toBe(20);
  });

  it("the layout keeps a supported size", async () => {
    const cookie = await initializePerPageCookieOnLayout(
      await prefsRequest(100)
    );

    expect(cookie.perPage).toBe(100);
  });
});
