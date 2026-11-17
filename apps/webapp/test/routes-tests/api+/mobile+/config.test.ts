/**
 * Route tests for GET /api/mobile/config — the per-instance self-description
 * the companion app reads before switching servers.
 *
 * The "no keys beyond the contract" test is the important one: this endpoint is
 * unauthenticated, so any field added here becomes public on every Shelf
 * instance. It must fail loudly if someone widens the payload.
 *
 * @see apps/webapp/app/routes/api+/mobile+/config.ts
 */
import { createLoaderArgs } from "@mocks/remix";
import { describe, expect, it, vi } from "vitest";

// why: React Router v7's single-fetch `data()` returns a DataWithResponseInit,
// not a Response. Mapping it to a real Response matches the rest of this suite.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
          },
        })
    )
);

// why: swaps in the Response-returning `data()` built above, so the assertions
// can read a status and a body instead of unwrapping a DataWithResponseInit.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// Mutable so a test can unset the latest version; the getter below reads it
// on every request.
const latestVersion = vi.hoisted(() => ({ value: "1.6.0" }));

// why: the route reads module-scope env exports; mocking the env module keeps
// the assertions independent of the developer's local .env.
vi.mock("~/utils/env", () => ({
  SUPABASE_URL: "https://xyz.supabase.co",
  SUPABASE_ANON_PUBLIC: "anon-key-123",
  INSTANCE_NAME: "Acme University",
  MIN_COMPANION_VERSION: "1.4.0",
  get LATEST_COMPANION_VERSION() {
    return latestVersion.value;
  },
}));

// why: the logger writes to the real log transport; the test only needs to see
// that a bad env value was reported.
const warn = vi.hoisted(() => vi.fn());
vi.mock("~/utils/logger", () => ({ Logger: { warn } }));

// why: `ssoEnabled` is derived from `config.disableSSO` and
// `config.oidc.enabled`, which read the DISABLE_SSO and OIDC_PROVIDER env
// vars. Pinning them keeps the asserted payload deterministic regardless of
// the local or CI environment, and lets a test switch one of them.
const ssoConfig = vi.hoisted(() => ({
  disableSSO: false,
  oidc: { enabled: false, buttonLabel: "Log in with SSO" },
}));
vi.mock("~/config/shelf.config", () => ({ config: ssoConfig }));

const { loader } = await import("~/routes/api+/mobile+/config");

/**
 * Invokes the loader with the arg shape React Router passes.
 *
 * The `as unknown as Response` cast is the established pattern in this suite:
 * `data()`'s static type is `DataWithResponseInit`, but the mock above returns
 * a real `Response`, which is what the assertions need.
 */
function invoke(): Response {
  return loader(
    createLoaderArgs({
      request: new Request("http://localhost/api/mobile/config"),
    })
  ) as unknown as Response;
}

describe("GET /api/mobile/config", () => {
  it("describes the instance", async () => {
    const response = await invoke();
    await expect(response.json()).resolves.toEqual({
      name: "Acme University",
      supabaseUrl: "https://xyz.supabase.co",
      supabaseAnonKey: "anon-key-123",
      mobileApiVersion: 1,
      minCompanionVersion: "1.4.0",
      latestCompanionVersion: "1.6.0",
      ssoEnabled: true,
      passwordLoginEnabled: true,
    });
  });

  it("advertises SSO when only the custom OIDC login is on", async () => {
    ssoConfig.disableSSO = true;
    ssoConfig.oidc.enabled = true;
    try {
      const body = (await invoke().json()) as Record<string, unknown>;
      // The app's SSO button opens /sso-login, which hosts the OIDC button.
      expect(body.ssoEnabled).toBe(true);
    } finally {
      ssoConfig.disableSSO = false;
      ssoConfig.oidc.enabled = false;
    }
  });

  it("advertises no SSO when both methods are off", async () => {
    ssoConfig.disableSSO = true;
    try {
      const body = (await invoke().json()) as Record<string, unknown>;
      expect(body.ssoEnabled).toBe(false);
    } finally {
      ssoConfig.disableSSO = false;
    }
  });

  it("advertises no latest version when the env var is unset", async () => {
    latestVersion.value = "";
    try {
      const body = (await invoke().json()) as Record<string, unknown>;
      // null, not "": the app treats null as "no banner".
      expect(body.latestCompanionVersion).toBeNull();
    } finally {
      latestVersion.value = "1.6.0";
    }
  });

  it("serves null and warns once for a version the app cannot read", async () => {
    latestVersion.value = "v1.6.0";
    try {
      const first = (await invoke().json()) as Record<string, unknown>;
      await invoke().json();
      expect(first.latestCompanionVersion).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(
        "LATEST_COMPANION_VERSION"
      );
    } finally {
      latestVersion.value = "1.6.0";
    }
  });

  it("exposes no keys beyond the documented contract", async () => {
    const response = await invoke();
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "latestCompanionVersion",
      "minCompanionVersion",
      "mobileApiVersion",
      "name",
      "passwordLoginEnabled",
      "ssoEnabled",
      "supabaseAnonKey",
      "supabaseUrl",
    ]);
  });
});
