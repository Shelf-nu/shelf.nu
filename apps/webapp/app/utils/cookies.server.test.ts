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
